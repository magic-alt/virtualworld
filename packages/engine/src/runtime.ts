import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import type { SceneSpec, SceneNode, Vector3Tuple } from '@virtualworld/scene-schema';
import { advanceStory, initialStory, SaveSystem, type StoryState } from '@virtualworld/interaction';
import { primitive } from './geometry';
import type { CharacterController } from '@virtualworld/interaction/character';
import { captureTransform } from './transforms';
export type RuntimeCallbacks = {
  onSelect?: (id: string) => void;
  onTransform?: (id: string, patch: Partial<SceneNode>) => void;
  onStory?: (state: StoryState, node?: SceneNode) => void;
  onMetrics?: (metrics: RuntimeMetrics) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
};
export type RuntimeMetrics = {
  fps: number;
  drawCalls: number;
  triangles: number;
  objects: number;
  splats: number;
  loading: boolean;
  errors: string[];
  player?: number[];
  story: StoryState;
  gpu: string;
  hotspots?: { id: string; label: string; x: number; y: number; inRange: boolean }[];
};
export class StudioRuntime {
  readonly ready: Promise<void>;
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  readonly controls: OrbitControls;
  readonly objects = new Map<string, THREE.Object3D>();
  readonly transform: TransformControls;
  private assets = new AssetRegistry();
  private saves = SaveSystem.browser();
  private content = new THREE.Group();
  private selector?: THREE.BoxHelper;
  private observer: ResizeObserver;
  private disposed = false;
  private generation = 0;
  private playing = false;
  private char?: CharacterController;
  private keys = new Set<string>();
  private story = initialStory();
  private last = 0;
  private metricAt = 0;
  private metricFrames = 0;
  private explosion = 0;
  private moving = false;
  private metrics: RuntimeMetrics = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    objects: 0,
    splats: 0,
    loading: true,
    errors: [],
    story: initialStory(),
    gpu: 'WebGL 2',
  };
  private dragStart?: THREE.Vector2;
  private originalCamera?: { position: THREE.Vector3; target: THREE.Vector3 };
  private selectedId?: string;
  constructor(
    private container: HTMLElement,
    public spec: SceneSpec,
    private callbacks: RuntimeCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '交互式三维场景');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.7);
    this.world.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
    });
    this.transform.addEventListener('mouseUp', () => {
      const o = this.transform.object;
      const node = this.spec.nodes.find((n) => n.id === this.selectedId);
      if (o && node)
        this.callbacks.onTransform?.(node.id, captureTransform(node, o, this.explosion));
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    container.addEventListener('pointerdown', this.pointerDown);
    container.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    const gl = this.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) this.metrics.gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    this.ready = this.load(spec).catch((error) => this.reportError(error, this.generation));
    this.renderer.setAnimationLoop(this.frame);
  }
  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
  async load(spec: SceneSpec) {
    const preserveView =
      this.generation > 0 &&
      this.spec.id === spec.id &&
      JSON.stringify(this.spec.camera) === JSON.stringify(spec.camera);
    const version = ++this.generation;
    this.spec = structuredClone(spec);
    this.stop();
    this.transform.detach();
    this.clearContent();
    this.metrics = {
      ...this.metrics,
      loading: true,
      errors: [],
      splats: 0,
      objects: spec.nodes.length,
    };
    this.content = new THREE.Group();
    this.world.add(this.content);
    this.world.background = new THREE.Color(spec.environment.background);
    this.world.fog = spec.environment.fog
      ? new THREE.FogExp2(spec.environment.background, spec.environment.fog)
      : null;
    const ambient = new THREE.HemisphereLight(
      '#d7e3ff',
      '#394157',
      spec.environment.ambientIntensity,
    );
    this.content.add(ambient);
    const sun = new THREE.DirectionalLight('#fff0da', spec.environment.lightIntensity);
    sun.position.set(6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.normalBias = 0.04;
    this.content.add(sun);
    const fill = new THREE.DirectionalLight('#abc7ff', spec.mode === 'industrial' ? 2 : 0.8);
    fill.position.set(-6, 3, -5);
    this.content.add(fill);
    const grid = new THREE.GridHelper(
      spec.mode === 'industrial' ? 18 : 40,
      spec.mode === 'industrial' ? 36 : 40,
      '#273244',
      '#202936',
    );
    grid.position.y = -0.43;
    grid.visible = spec.mode === 'industrial';
    this.content.add(grid);
    if (!preserveView) this.resetCamera();
    else this.controls.update();
    if (spec.nodes.some((n) => n.kind === 'splat'))
      await this.assets.prepareSplats(this.renderer, this.world);
    if (version !== this.generation || this.disposed) return;
    const loads: Promise<unknown>[] = [];
    for (const node of spec.nodes) {
      let object: THREE.Object3D;
      if (node.kind === 'splat') {
        const asset = spec.assets.find((a) => a.id === node.assetId)!;
        const splat = this.assets.createSplat(asset);
        object = splat;
        loads.push(
          splat.initialized
            .then(() => {
              if (version === this.generation) this.metrics.splats += splat.numSplats;
            })
            .catch((e) => this.reportError(e, version)),
        );
      } else if (node.shape === 'glb') {
        object = new THREE.Group();
        const holder = object;
        const asset = spec.assets.find((a) => a.id === node.assetId)!;
        loads.push(
          this.assets
            .loadInstance(asset, node)
            .then((instance) => {
              if (version !== this.generation || this.disposed) {
                disposeObject(instance);
                return;
              }
              holder.add(instance);
            })
            .catch((e) => this.reportError(e, version)),
        );
      } else if (node.kind === 'light') {
        object = new THREE.PointLight(node.color, node.emissive ?? 2, 20);
      } else object = primitive(node);
      object.name = node.name;
      object.userData.nodeId = node.id;
      object.userData.basePosition = [...node.position];
      object.position.fromArray(node.position);
      object.rotation.set(...node.rotation);
      if (node.joint) object.rotation[node.joint.axis] += node.joint.value;
      object.scale.multiply(new THREE.Vector3(...node.scale));
      object.visible = node.visible;
      object.traverse((o) => {
        o.userData.nodeId = node.id;
      });
      this.objects.set(node.id, object);
    }
    for (const node of spec.nodes) {
      const object = this.objects.get(node.id)!;
      const parent = node.parentId ? this.objects.get(node.parentId) : this.content;
      (parent || this.content).add(object);
    }
    this.content.updateMatrixWorld(true);
    this.explode(this.explosion);
    await Promise.all(loads);
    if (this.disposed || version !== this.generation) return;
    this.metrics.loading = false;
    this.select(this.selectedId);
    this.callbacks.onReady?.();
  }
  private reportError(error: unknown, version: number) {
    if (version !== this.generation || this.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    this.metrics.errors.push(message);
    this.callbacks.onError?.(message);
  }
  select(id?: string) {
    this.selectedId = id;
    if (this.selector) {
      this.world.remove(this.selector);
      this.selector.geometry.dispose();
      (this.selector.material as THREE.Material).dispose();
      this.selector = undefined;
    }
    this.transform.detach();
    const object = id ? this.objects.get(id) : undefined;
    if (object && !this.playing) {
      this.selector = new THREE.BoxHelper(object, '#d8bd8c');
      this.world.add(this.selector);
      if (!object.userData.isSplat) this.transform.attach(object);
    }
  }
  setTransformMode(mode: 'translate' | 'rotate' | 'scale') {
    this.transform.setMode(mode);
  }
  focus(id?: string) {
    const object = id ? this.objects.get(id) : this.content;
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const target = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()).length();
    this.controls.minDistance = Math.max(0.001, size * 0.01);
    this.camera.near = Math.max(0.0001, size / 1000);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.camera.position
      .copy(target)
      .add(new THREE.Vector3(1, 0.7, 1).multiplyScalar(Math.max(0.015, size * 0.85)));
  }
  resetCamera() {
    this.camera.position.fromArray(this.spec.camera.position);
    this.controls.target.fromArray(this.spec.camera.target);
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.controls.minDistance = Math.min(1, Math.max(0.001, distance * 0.01));
    this.camera.near = Math.min(0.05, Math.max(0.0001, distance / 100));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  explode(amount: number) {
    this.explosion = amount;
    for (const n of this.spec.nodes) {
      const o = this.objects.get(n.id);
      if (o)
        o.position.set(
          n.position[0] + (n.explode?.[0] || 0) * amount,
          n.position[1] + (n.explode?.[1] || 0) * amount,
          n.position[2] + (n.explode?.[2] || 0) * amount,
        );
    }
  }
  animateJoints(enabled: boolean) {
    this.moving = enabled;
    if (!enabled)
      for (const node of this.spec.nodes) {
        const o = this.objects.get(node.id);
        if (o) {
          o.rotation.set(...node.rotation);
          if (node.joint) o.rotation[node.joint.axis] += node.joint.value;
        }
      }
  }
  async play() {
    if (this.playing) return;
    this.originalCamera = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    this.story = this.saves.load(this.spec);
    this.playing = true;
    this.select(undefined);
    this.explode(0);
    this.controls.enablePan = false;
    this.callbacks.onStory?.(this.story);
    if (this.spec.mode === 'world') {
      try {
        const generation = this.generation;
        const { CharacterController } = await import('@virtualworld/interaction/character');
        const char = await CharacterController.create(this.spec, this.objects);
        if (!this.playing || this.disposed || generation !== this.generation) {
          char.dispose();
          return;
        }
        this.char = char;
        this.world.add(char.object);
        this.camera.position.copy(char.object.position).add(new THREE.Vector3(7, 6, 9));
        this.controls.target.copy(char.object.position).add(new THREE.Vector3(0, 1, 0));
        this.controls.maxDistance = 20;
      } catch (error) {
        this.reportError(error, this.generation);
        this.stop();
      }
    }
  }
  stop() {
    this.playing = false;
    this.keys.clear();
    if (this.char) {
      this.world.remove(this.char.object);
      disposeObject(this.char.object);
      this.char.dispose();
      this.char = undefined;
    }
    this.controls.enablePan = true;
    this.controls.maxDistance = 80;
    if (this.originalCamera) {
      this.camera.position.copy(this.originalCamera.position);
      this.controls.target.copy(this.originalCamera.target);
      this.originalCamera = undefined;
    }
    this.story = initialStory();
  }
  interact(id?: string) {
    const target = id ? this.spec.nodes.find((n) => n.id === id) : this.nearest();
    if (!target?.interaction) return;
    if (this.playing && this.char && this.nodeDistance(target.id) > 2.6) return;
    this.story = advanceStory(this.spec, this.story, target.id);
    if (this.playing) this.saves.save(this.spec, this.story);
    this.callbacks.onStory?.(this.story, target);
  }
  nearest() {
    return this.spec.nodes
      .filter((n) => n.interaction && n.visible)
      .sort((a, b) => this.nodeDistance(a.id) - this.nodeDistance(b.id))
      .find((n) => this.nodeDistance(n.id) < 2.6);
  }
  private nodeDistance(id: string) {
    const o = this.objects.get(id);
    if (!o || !this.char) return Infinity;
    const pos = o.getWorldPosition(new THREE.Vector3());
    pos.y = this.char.object.position.y;
    return pos.distanceTo(this.char.object.position);
  }
  isolate(id?: string) {
    for (const node of this.spec.nodes) {
      const o = this.objects.get(node.id);
      if (o)
        o.visible = id
          ? node.id === id || this.isAncestor(node.id, id) || this.isAncestor(id, node.id)
          : node.visible;
    }
  }
  private isAncestor(parent: string, child: string) {
    let node = this.spec.nodes.find((n) => n.id === child);
    while (node?.parentId) {
      if (node.parentId === parent) return true;
      node = this.spec.nodes.find((n) => n.id === node?.parentId);
    }
    return false;
  }
  getDiagnostics(): RuntimeMetrics {
    return {
      ...this.metrics,
      player: this.char?.object.position.toArray(),
      story: structuredClone(this.story),
      hotspots: this.getHotspots(),
    };
  }
  private getHotspots() {
    const { width, height } = this.container.getBoundingClientRect();
    return this.spec.nodes
      .filter((n) => n.interaction && n.visible)
      .flatMap((n) => {
        const object = this.objects.get(n.id);
        if (!object || !this.objectVisible(object)) return [];
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) return [];
        const point = bounds.getCenter(new THREE.Vector3());
        point.y = bounds.max.y + 0.35;
        point.project(this.camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.95 || Math.abs(point.y) > 0.95)
          return [];
        return [
          {
            id: n.id,
            label: n.interaction!.title,
            x: ((point.x + 1) * width) / 2,
            y: ((1 - point.y) * height) / 2,
            inRange: !this.char || this.nodeDistance(n.id) < 2.6,
          },
        ];
      });
  }
  private objectVisible(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }
  screenshot() {
    return this.renderer.domElement.toDataURL('image/png');
  }
  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    this.metricFrames++;
    if (this.char) {
      this.char.keys = this.keys;
      const previous = this.char.object.position.clone();
      this.char.step(dt, this.spec.spawn);
      const delta = this.char.object.position.clone().sub(previous);
      this.camera.position.add(delta);
      this.controls.target.copy(this.char.object.position).add(new THREE.Vector3(0, 1, 0));
    }
    if (this.moving)
      for (const node of this.spec.nodes)
        if (node.joint) {
          const o = this.objects.get(node.id);
          if (o)
            o.rotation[node.joint.axis] =
              node.rotation[{ x: 0, y: 1, z: 2 }[node.joint.axis]] +
              (node.joint.min + node.joint.max) / 2 +
              (Math.sin(now / 1300) * (node.joint.max - node.joint.min)) / 2;
        }
    this.controls.update();
    this.selector?.update();
    this.renderer.render(this.world, this.camera);
    if (now - this.metricAt > 700) {
      this.metrics = {
        ...this.metrics,
        fps: Math.round((this.metricFrames * 1000) / (now - this.metricAt)),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        story: structuredClone(this.story),
        player: this.char?.object.position.toArray(),
      };
      this.metricAt = now;
      this.metricFrames = 0;
      this.callbacks.onMetrics?.(this.getDiagnostics());
    }
  };
  private pointerDown = (event: PointerEvent) => {
    this.dragStart = new THREE.Vector2(event.clientX, event.clientY);
  };
  private pointerUp = (event: PointerEvent) => {
    if (
      !this.dragStart ||
      this.dragStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5 ||
      this.transform.dragging
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect(),
      pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray
      .intersectObjects(
        this.content.children.filter((o) => o.userData.nodeId),
        true,
      )
      .find((h) => h.object.userData.nodeId && this.objectVisible(h.object));
    const id = hit?.object.userData.nodeId as string | undefined;
    if (!id) return;
    if (this.playing) this.interact(id);
    else {
      this.select(id);
      this.callbacks.onSelect?.(id);
    }
  };
  private keyDown = (event: KeyboardEvent) => {
    const el = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
    if (
      this.playing &&
      ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)
    )
      event.preventDefault();
    this.keys.add(event.code);
    if (this.playing && event.code === 'KeyE' && !event.repeat) this.interact();
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private blur = () => this.keys.clear();
  resetProgress() {
    this.saves.reset(this.spec);
    this.story = initialStory();
    this.callbacks.onStory?.(this.story);
  }
  private clearContent() {
    this.world.remove(this.content);
    disposeObject(this.content);
    this.objects.clear();
    this.assets.clear();
    if (this.selector) {
      this.world.remove(this.selector);
      this.selector.geometry.dispose();
      (this.selector.material as THREE.Material).dispose();
      this.selector = undefined;
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.stop();
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.container.removeEventListener('pointerdown', this.pointerDown);
    this.container.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    this.transform.dispose();
    this.controls.dispose();
    this.clearContent();
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
