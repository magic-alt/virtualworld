import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SceneAsset, SceneNode } from '@virtualworld/scene-schema';

/** One registry per renderer. GLB source cache lives for one loaded scene. */
export class AssetRegistry {
  private glbs = new Map<string, Promise<THREE.Object3D>>();
  private library?: typeof import('@sparkjsdev/spark');
  private spark?: SparkRenderer;
  private libraryPromise?: Promise<typeof import('@sparkjsdev/spark')>;
  private disposed = false;
  constructor(
    private loader = async (url: string): Promise<THREE.Object3D> =>
      (await new GLTFLoader().loadAsync(url)).scene,
    private importSplats = () => import('@sparkjsdev/spark'),
  ) {}

  async prepareSplats(renderer: THREE.WebGLRenderer, world: THREE.Scene) {
    if (this.disposed) return;
    this.libraryPromise ??= this.importSplats();
    this.library = await this.libraryPromise;
    if (this.disposed) return;
    if (!this.spark) {
      this.spark = new this.library.SparkRenderer({ renderer });
      world.add(this.spark);
    }
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
    return instance;
  }
  clear() {
    for (const promise of this.glbs.values()) void promise.then(disposeObject).catch(() => {});
    this.glbs.clear();
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.spark?.removeFromParent();
    this.spark?.dispose();
    this.spark = undefined;
  }
}
export function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(),
    materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>();
  object.traverse((o) => {
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
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
