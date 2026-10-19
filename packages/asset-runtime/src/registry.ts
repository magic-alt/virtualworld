import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SceneAsset, SceneNode } from '@virtualworld/scene-schema';

type SparkRequest = {
  world: THREE.Scene;
  camera: THREE.Camera;
  signature: string;
  onFailure: (error: unknown) => void;
};
type SparkWork = {
  retired: boolean;
  failed: boolean;
  signature?: string;
  pending?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  request?: SparkRequest;
};

/** One registry per renderer. GLB source cache lives for one loaded scene. */
export class AssetRegistry {
  private glbs = new Map<string, Promise<THREE.Object3D>>();
  private library?: typeof import('@sparkjsdev/spark');
  private spark?: SparkRenderer;
  private restoringSpark?: SparkRenderer;
  private graphicsGeneration = 0;
  private graphicsRestore?: number;
  private sparkWork = new WeakMap<SparkRenderer, SparkWork>();
  private retiringUpdates = new Set<Promise<void>>();
  private libraryPromise?: Promise<typeof import('@sparkjsdev/spark')>;
  private disposed = false;
  constructor(
    private loader = async (url: string): Promise<THREE.Object3D> => await loadAnimatedGlb(url),
    private importSplats = () => import('@sparkjsdev/spark'),
  ) {}

  async prepareSplats(renderer: THREE.WebGLRenderer, world: THREE.Scene, available = () => true) {
    if (this.disposed) return;
    this.libraryPromise ??= this.importSplats();
    this.library = await this.libraryPromise;
    if (this.disposed) return;
    if (
      !this.spark &&
      this.graphicsRestore === undefined &&
      available() &&
      !renderer.getContext?.().isContextLost()
    ) {
      // SplatMesh is authored with lod:false; avoid Spark's unawaited LoD driver.
      this.spark = this.makeSpark(this.library, renderer);
      world.add(this.spark);
    }
  }
  /** Spark owns generated GPU accumulators/order textures; retain SplatMesh CPU data and rebuild only its renderer. */
  async restoreGraphics(
    renderer: THREE.WebGLRenderer,
    world: THREE.Scene,
    camera: THREE.Camera,
    current: () => boolean,
  ) {
    if (!this.libraryPromise) return;
    this.releaseGraphics();
    const generation = this.graphicsGeneration;
    this.graphicsRestore = generation;
    let replacement: SparkRenderer | undefined;
    try {
      const retiredUpdates = [...this.retiringUpdates];
      if (retiredUpdates.length) await Promise.allSettled(retiredUpdates);
      const library = await this.libraryPromise;
      if (this.disposed || !current() || generation !== this.graphicsGeneration) return;
      replacement = this.makeSpark(library, renderer);
      this.restoringSpark = replacement;
      const signature = this.graphicsSignature(world, camera);
      const work = this.sparkWork.get(replacement)!;
      const pending = replacement.update({ scene: world, camera });
      work.pending = pending;
      try {
        await pending;
      } finally {
        this.retiringUpdates.delete(pending);
        if (work.pending === pending) work.pending = undefined;
      }
      if (this.disposed || !current() || generation !== this.graphicsGeneration) return;
      this.restoringSpark = undefined;
      this.sparkWork.get(replacement)!.signature = signature;
      this.spark = replacement;
      world.add(replacement);
    } finally {
      if (replacement && this.spark !== replacement) {
        if (this.restoringSpark === replacement) this.restoringSpark = undefined;
        // The pinned Spark can resume GPU readback after early dispose and allocate
        // a new sort worker/ordering texture. Dispose its own settled resources
        // again, even after ownership was transferred to a newer restoration.
        replacement.dispose();
      }
      if (this.graphicsRestore === generation) this.graphicsRestore = undefined;
    }
  }
  /** Stop Spark background GPU work immediately, including a timed-out recovery. */
  releaseGraphics() {
    this.graphicsGeneration++;
    this.graphicsRestore = undefined;
    const renderers = new Set([this.spark, this.restoringSpark]);
    this.spark = this.restoringSpark = undefined;
    for (const spark of renderers) {
      if (spark) {
        const work = this.sparkWork.get(spark);
        if (work) {
          work.retired = true;
          if (work.pending) this.retiringUpdates.add(work.pending);
          work.request = undefined;
          clearTimeout(work.timer);
        }
      }
      spark?.removeFromParent();
      spark?.dispose();
    }
  }
  private makeSpark(library: typeof import('@sparkjsdev/spark'), renderer: THREE.WebGLRenderer) {
    // Public update() is owned here: Spark's implicit render hook otherwise
    // fires an uncaught async sort. LoD is not enabled on this project's splats.
    const spark = new library.SparkRenderer({ renderer, autoUpdate: false, enableDriveLod: false });
    this.sparkWork.set(spark, { retired: false, failed: false });
    return spark;
  }
  private graphicsSignature(world: THREE.Scene, camera: THREE.Camera) {
    world.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const parts: (string | number | boolean)[] = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
    ];
    world.traverse((object) => {
      if (!object.userData.isSplat) return;
      let visible = true;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
        visible &&= parent.visible;
      const splat = object as SplatMesh;
      parts.push(
        object.uuid,
        visible,
        ...object.matrixWorld.elements,
        splat.version,
        splat.isInitialized,
        splat.numSplats,
      );
    });
    return parts.join(',');
  }
  /** Queue the newest visible static-splat inputs; at most one public GPU update is in flight. */
  updateGraphics(world: THREE.Scene, camera: THREE.Camera, onFailure: (error: unknown) => void) {
    const spark = this.spark;
    if (!spark || this.disposed) return;
    const work = this.sparkWork.get(spark)!;
    if (work.retired || work.failed) return;
    work.request = { world, camera, signature: this.graphicsSignature(world, camera), onFailure };
    this.pumpSpark(spark, work);
  }
  private pumpSpark(spark: SparkRenderer, work: SparkWork) {
    if (work.retired || work.failed || work.pending) return;
    const request = work.request;
    work.request = undefined;
    if (!request || request.signature === work.signature) return;
    const active = () => !this.disposed && !work.retired && this.spark === spark;
    work.timer = setTimeout(() => {
      if (active()) {
        work.failed = true;
        request.onFailure(new Error('图形资源更新超时，请重试恢复。'));
      }
    }, 15000);
    const pending = Promise.resolve()
      .then(async () => {
        if (!active()) return;
        await spark.update({ scene: request.world, camera: request.camera });
        if (active()) work.signature = request.signature;
      })
      .catch((error: unknown) => {
        if (active() && !work.failed) {
          work.failed = true;
          request.onFailure(error);
        }
      })
      .finally(() => {
        clearTimeout(work.timer);
        this.retiringUpdates.delete(pending);
        work.pending = undefined;
        if (work.retired || this.spark !== spark || this.disposed) spark.dispose();
        else this.pumpSpark(spark, work);
      });
    work.pending = pending;
  }
  createSplat(asset: SceneAsset): SplatMesh {
    if (!this.library || this.disposed)
      throw new Error('Call prepareSplats before createSplat on a live registry');
    const splat = new this.library.SplatMesh({ url: asset.url, raycastable: false, lod: false });
    splat.userData.isSplat = true;
    return splat;
  }
  async loadInstance(asset: SceneAsset, node: SceneNode): Promise<THREE.Object3D> {
    if (this.disposed) throw new Error('Asset registry has been disposed');
    // Include URL: an asset ID can be reused by an edited, versioned manifest.
    const key = `${asset.id}:${asset.url}`;
    let promise = this.glbs.get(key);
    if (!promise) {
      promise = this.loader(asset.url);
      this.glbs.set(key, promise);
    }
    const root = await promise;
    let source = root;
    if (node.assetNode !== undefined) {
      for (const part of node.assetNode.split('.').filter(Boolean)) {
        source = source.children[Number(part)];
        if (!source) throw new Error('GLB 层级引用无效');
      }
    }
    const instance = node.assetNode === undefined ? cloneSkeleton(source) : source.clone(false);
    if (node.assetNode !== undefined) {
      instance.position.set(0, 0, 0);
      instance.rotation.set(0, 0, 0);
      instance.scale.set(1, 1, 1);
    }
    instance.traverse((child) => {
      child.userData.nodeId = node.id;
      if (child instanceof THREE.Mesh) {
        child.geometry = child.geometry.clone();
        const mats = (Array.isArray(child.material) ? child.material : [child.material]).map(
          (m) => {
            const mat = m.clone() as THREE.MeshStandardMaterial;
            // Instances own their textures as well as materials, so disposing an instance is safe.
            for (const [key, value] of Object.entries(mat)) {
              if (value instanceof THREE.Texture) (mat as any)[key] = value.clone();
            }
            if (node.materialOverride && mat.color) mat.color.set(node.color);
            if (node.metalness !== undefined) mat.metalness = node.metalness;
            if (node.roughness !== undefined) mat.roughness = node.roughness;
            return mat;
          },
        );
        child.material = Array.isArray(child.material) ? mats : mats[0];
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    instance.animations = root.animations.map((clip) => clip.clone());
    return instance;
  }
  clear() {
    for (const promise of this.glbs.values()) void promise.then(disposeObject).catch(() => {});
    this.glbs.clear();
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.releaseGraphics();
  }
}
export async function loadAnimatedGlb(url: string) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}

export function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>(),
    materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>();
  object.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
    if (o.userData.isSplat) (o as SplatMesh).dispose();
    if (o instanceof THREE.Light) o.dispose();
    if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
