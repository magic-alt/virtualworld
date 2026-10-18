import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { harmonicState, MechanismController, type MechanismState } from './mechanism';
export type MechanismViewState = MechanismState & {
  section: boolean;
  explosion: number;
  hiddenSubsystems: string[];
  isolatedSubsystem?: string;
};
import { updateOrbitControls } from './sphere-camera';
import { sphereOccludes } from '@virtualworld/interaction';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import type { SceneSpec, SceneNode, Vector3Tuple } from '@virtualworld/scene-schema';
import { advanceStory, initialStory, SaveSystem, type StoryState } from '@virtualworld/interaction';
import { primitive } from './geometry';
import type { CharacterController } from '@virtualworld/interaction/character';
import { captureTransform } from './transforms';
export type PresentationMode = 'view' | 'explore' | 'edit';
export type RenderQuality = 'low' | 'balanced' | 'high';
export type RuntimeCallbacks = {
  onSelect?: (id: string) => void;
  onTransform?: (id: string, patch: Partial<SceneNode>) => void;
  onStory?: (state: StoryState, node?: SceneNode) => void;
  onMetrics?: (metrics: RuntimeMetrics) => void;
  onError?: (error: string) => void;
  onReady?: () => void;
};
export type RuntimeMetrics = {
  mode?: PresentationMode;
  paused?: boolean;
  quality?: RenderQuality;
  mechanism?: MechanismViewState;
  radialUp?: number[];
  actorClip?: string;
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
  private mode: PresentationMode = 'edit';
  private paused = false;
  private quality: RenderQuality = 'balanced';
  private movement = { x: 0, y: 0, jump: false };
  private cameraTransition?: {
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
  };
  private playRequest = 0;
  private char?: CharacterController;
  private keys = new Set<string>();
  private story = initialStory();
  private last = 0;
  private metricAt = 0;
  private metricFrames = 0;
  private explosion = 0;
  private moving = false;
  private inputAngle = 0;
  private inputRpm = 6;
  private section = false;
  private mechanismController?: MechanismController;
  private mechanismListeners = new Set<(state: MechanismViewState) => void>();
  private hiddenSubsystems = new Set<string>();
  private isolatedSubsystem?: string;
  private mechanismView: 'default' | 'front' | 'side' | 'top' | 'bottom' = 'default';
  private mechanismInsets = { top: 100, bottom: 80, left: 20, right: 20 };
  private isolatedId?: string;
  private mixers: THREE.AnimationMixer[] = [];
  private actorSource?: THREE.Object3D;
  private actorMixer?: THREE.AnimationMixer;
  private actorAction?: THREE.AnimationAction;
  private interactUntil = 0;
  private environment?: THREE.WebGLRenderTarget;
  private loadComplete: Promise<unknown> = Promise.resolve();
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
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.world.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
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
    if (this.spec.mechanism && !this.metrics.loading) this.fitMechanismView(this.mechanismView);
  }
  async setMode(mode: PresentationMode) {
    const from = this.camera.position.clone(),
      fromTarget = this.controls.target.clone(),
      fromUp = this.camera.up.clone();
    this.cameraTransition = undefined;
    this.mode = mode;
    this.setPaused(false);
    if (mode === 'explore') await this.play();
    else {
      this.stop();
      this.select(mode === 'edit' ? this.selectedId : undefined);
    }
    if (this.disposed || this.mode !== mode) return;
    const grid = this.content.getObjectByName('editor-grid');
    if (grid) grid.visible = mode === 'edit' && this.spec.mode === 'industrial';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && mode !== 'edit') {
      this.cameraTransition = {
        start: performance.now(),
        from,
        fromTarget,
        fromUp,
        to: this.camera.position.clone(),
        toTarget: this.controls.target.clone(),
        toUp: this.camera.up.clone(),
      };
    }
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    this.mechanismController?.tick(0, paused);
    this.keys.clear();
    this.movement = { x: 0, y: 0, jump: false };
    this.controls.enabled = !paused;
    this.last = 0;
  }
  setSuspended(suspended: boolean) {
    if (this.disposed) return;
    this.last = 0;
    this.renderer.setAnimationLoop(suspended ? null : this.frame);
  }
  setMovement(input: { x: number; y: number; jump: boolean }) {
    this.movement = {
      x: Number.isFinite(input.x) ? THREE.MathUtils.clamp(input.x, -1, 1) : 0,
      y: Number.isFinite(input.y) ? THREE.MathUtils.clamp(input.y, -1, 1) : 0,
      jump: !!input.jump,
    };
  }
  setQuality(quality: RenderQuality) {
    this.quality = quality;
    const settings = { low: [1, 512], balanced: [1.5, 1024], high: [2, 2048] }[quality];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings[0]));
    this.content.traverse((object) => {
      if (object instanceof THREE.DirectionalLight && object.castShadow) {
        object.shadow.mapSize.set(settings[1], settings[1]);
        object.shadow.map?.dispose();
        object.shadow.map = null;
      }
    });
    this.resize();
  }
  load(spec: SceneSpec) {
    const loading = this.loadScene(spec);
    this.loadComplete = loading;
    return loading;
  }
  private async loadScene(spec: SceneSpec) {
    const preserveView =
      this.generation > 0 &&
      this.spec.id === spec.id &&
      JSON.stringify(this.spec.camera) === JSON.stringify(spec.camera);
    const version = ++this.generation;
    this.spec = structuredClone(spec);
    this.inputAngle = 0;
    this.section = false;
    this.isolatedId = undefined;
    this.stop();
    this.transform.detach();
    this.clearContent();
    this.mechanismController?.dispose();
    this.hiddenSubsystems.clear();
    this.isolatedSubsystem = undefined;
    this.explosion = 0;
    this.inputRpm = 6;
    this.mechanismController = spec.mechanism
      ? new MechanismController({
          ...spec.mechanism,
          hasBrake: !!spec.mechanism.subsystems?.some((s) => s.optional === 'brake'),
        })
      : undefined;
    this.mechanismController?.subscribe((state) => {
      this.inputAngle = state.inputAngle;
      this.inputRpm = state.inputRpm;
      this.applyMechanism(true);
      this.notifyMechanism();
    });
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
    const span = spec.mechanism
      ? Math.max(spec.mechanism.dimensions.totalHeight, spec.mechanism.dimensions.baseDiameter) * 2
      : 16;
    const target = new THREE.Vector3(...spec.camera.target);
    sun.position.copy(target).add(new THREE.Vector3(6, 12, 5).multiplyScalar(span / 16));
    sun.target.position.copy(target);
    this.content.add(sun.target);
    sun.castShadow = true;
    const resolution = { low: 512, balanced: 1024, high: 2048 }[this.quality];
    sun.shadow.mapSize.set(resolution, resolution);
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.near = Math.max(0.001, span / 100);
    sun.shadow.camera.far = span * 5;
    sun.shadow.normalBias = span * 0.0005;
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
    grid.name = 'editor-grid';
    grid.visible = spec.mode === 'industrial' && this.mode === 'edit';
    this.content.add(grid);
    if (!preserveView) this.resetCamera();
    else updateOrbitControls(this.controls);
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
              if (node.animation) {
                const clip = THREE.AnimationClip.findByName(
                  instance.animations,
                  node.animation.clip,
                );
                if (clip) {
                  const mixer = new THREE.AnimationMixer(instance);
                  const action = mixer.clipAction(clip);
                  action.setLoop(
                    node.animation.loop === false ? THREE.LoopOnce : THREE.LoopRepeat,
                    Infinity,
                  );
                  action.clampWhenFinished = true;
                  action.timeScale = node.animation.speed ?? 1;
                  action.play();
                  this.mixers.push(mixer);
                }
              }
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
    if (spec.actor) {
      const asset = spec.assets.find((a) => a.id === spec.actor!.assetId)!;
      const actorNode = {
        ...spec.nodes[0],
        id: 'runtime-actor',
        assetNode: undefined,
        materialOverride: false,
        metalness: undefined,
        roughness: undefined,
      } as SceneNode;
      loads.push(
        this.assets.loadInstance(asset, actorNode).then((actor) => {
          if (version !== this.generation || this.disposed) {
            disposeObject(actor);
            return;
          }
          const box = new THREE.Box3().setFromObject(actor),
            height = box.getSize(new THREE.Vector3()).y;
          if (height > 0) actor.scale.multiplyScalar(spec.actor!.height / height);
          this.actorSource = actor;
        }),
      );
    }
    await Promise.all(loads);
    if (this.disposed || version !== this.generation) return;
    this.content.updateMatrixWorld(true);
    this.setSection(false);
    // Fit shadows to visible scene geometry, including millimetre-scale imports.
    const bounds = new THREE.Box3();
    for (const [id, object] of this.objects) {
      if (this.spec.nodes.find((n) => n.id === id)?.kind !== 'light' && this.objectVisible(object))
        bounds.expandByObject(object);
    }
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3()),
        radius = Math.max(0.03, bounds.getSize(new THREE.Vector3()).length() / 2);
      sun.position
        .copy(center)
        .add(new THREE.Vector3(0.5, 1, 0.4).normalize().multiplyScalar(radius * 2.5));
      sun.target.position.copy(center);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -radius;
      sun.shadow.camera.right = sun.shadow.camera.top = radius;
      sun.shadow.camera.near = radius * 0.01;
      sun.shadow.camera.far = radius * 5;
      sun.shadow.normalBias = radius * 0.0005;
      sun.shadow.camera.updateProjectionMatrix();
    }
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
    if (object && !this.playing && this.mode === 'edit') {
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
    updateOrbitControls(this.controls);
  }
  explode(amount: number) {
    if (!Number.isFinite(amount)) return;
    amount = THREE.MathUtils.clamp(amount, 0, 1);
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
    this.notifyMechanism();
  }
  animateJoints(enabled: boolean) {
    if (this.spec.mechanism) {
      this.mechanismController?.setMoving(enabled);
      return;
    }
    this.moving = enabled;
    if (!enabled) {
      this.inputAngle = 0;
      this.applyMechanism(false);
    }
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
    const request = ++this.playRequest;
    const requestedGeneration = this.generation;
    await this.loadComplete;
    if (
      this.disposed ||
      requestedGeneration !== this.generation ||
      this.playing ||
      request !== this.playRequest
    )
      return;
    if (this.spec.actor && !this.actorSource) {
      this.reportError(new Error('角色资源尚未加载'), this.generation);
      return;
    }
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
        const char = await CharacterController.create(
          this.spec,
          this.objects,
          this.actorSource,
          this.spec.actor?.height,
        );
        if (
          !this.playing ||
          this.disposed ||
          generation !== this.generation ||
          request !== this.playRequest
        ) {
          char.dispose();
          return;
        }
        this.char = char;
        this.actorSource = undefined;
        if (this.spec.actor) {
          this.actorMixer = new THREE.AnimationMixer(char.object);
          this.setActorClip(this.spec.actor.clips.idle);
        }
        this.world.add(char.object);
        if (this.spec.navigation?.kind === 'sphere') {
          this.camera.up.copy(char.up);
          this.camera.position
            .copy(char.object.position)
            .addScaledVector(char.up, 4)
            .add(new THREE.Vector3(0, 0, 7));
        } else this.camera.position.copy(char.object.position).add(new THREE.Vector3(7, 6, 9));
        this.controls.target.copy(char.object.position).add(new THREE.Vector3(0, 1, 0));
        this.controls.maxDistance = 20;
      } catch (error) {
        this.reportError(error, this.generation);
        this.stop();
      }
    }
  }
  stop() {
    this.cameraTransition = undefined;
    this.playRequest++;
    this.animateJoints(false);
    this.playing = false;
    this.actorMixer?.stopAllAction();
    if (this.char) this.actorMixer?.uncacheRoot(this.char.object);
    this.actorMixer = undefined;
    this.actorAction = undefined;
    this.keys.clear();
    if (this.char) {
      this.world.remove(this.char.object);
      if (this.spec.actor) this.actorSource = this.char.object;
      else disposeObject(this.char.object);
      this.char.dispose();
      this.char = undefined;
    }
    this.camera.up.set(0, 1, 0);
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
    if (this.mode === 'view' || this.paused) return;
    const target = id ? this.spec.nodes.find((n) => n.id === id) : this.nearest();
    if (!target?.interaction) return;
    if (this.playing && this.char && this.nodeDistance(target.id) > 2.6) return;
    this.interactUntil = performance.now() + 1200;
    if (this.spec.actor && this.char) this.setActorClip(this.spec.actor.clips.interact);
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
    if (this.spec.navigation?.kind !== 'sphere') pos.y = this.char.object.position.y;
    return pos.distanceTo(this.char.object.position);
  }
  isolate(id?: string) {
    this.isolatedId = id;
    for (const node of this.spec.nodes) {
      const o = this.objects.get(node.id);
      if (o)
        o.visible = id
          ? node.id === id || this.isAncestor(node.id, id) || this.isAncestor(id, node.id)
          : node.visible;
      if (o && this.spec.mechanism) {
        const m = this.spec.mechanism;
        if (m.fullHousingIds.includes(node.id)) o.visible = o.visible && !this.section;
        if (m.sectionHousingIds.includes(node.id))
          o.visible = (id ? o.visible : true) && this.section;
        const subsystem = m.subsystems?.find((s) => s.nodeIds.includes(node.id));
        if (subsystem) {
          if (
            this.hiddenSubsystems?.has(subsystem.id) ||
            (this.isolatedSubsystem && this.isolatedSubsystem !== subsystem.id)
          )
            o.visible = false;
          if (
            subsystem.optional === 'brake' &&
            !this.mechanismController?.snapshot().brakeInstalled
          )
            o.visible = false;
        } else if (this.isolatedSubsystem && node.kind !== 'group') o.visible = false;
      }
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
      mode: this.mode,
      paused: this.paused,
      quality: this.quality,
      mechanism: this.spec.mechanism ? this.getMechanismState() : undefined,
      radialUp: this.char?.up.toArray(),
      actorClip: this.actorAction?.getClip().name,
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
        const empty = bounds.isEmpty();
        const point = empty
          ? object.getWorldPosition(new THREE.Vector3())
          : bounds.getCenter(new THREE.Vector3());
        if (this.spec.navigation?.kind === 'sphere') {
          const nav = this.spec.navigation;
          const center = new THREE.Vector3(...nav.center);
          if (sphereOccludes(this.camera.position, point, center, nav.radius)) return [];
          point.addScaledVector(point.clone().sub(center).normalize(), 0.5);
        } else point.y = (empty ? point.y : bounds.max.y) + 0.35;
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
    const dt = this.paused ? 0 : this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    this.metricFrames++;
    if (this.char && !this.paused) {
      this.char.keys = this.keys;
      this.char.movement = this.movement;
      this.camera.getWorldDirection(this.char.cameraForward);
      const oldUp = this.char.up.clone();
      const previous = this.char.object.position.clone();
      this.char.step(dt, this.spec.spawn);
      const delta = this.char.object.position.clone().sub(previous);
      if (this.spec.navigation?.kind === 'sphere') {
        const rotation = new THREE.Quaternion().setFromUnitVectors(oldUp, this.char.up);
        const offset = this.camera.position.clone().sub(previous).applyQuaternion(rotation);
        this.camera.position.copy(this.char.object.position).add(offset);
        this.camera.up.copy(this.char.up);
      } else this.camera.position.add(delta);
      this.controls.target.copy(this.char.object.position).addScaledVector(this.char.up, 1);
      if (this.spec.actor)
        this.setActorClip(
          now < this.interactUntil
            ? this.spec.actor.clips.interact
            : this.char.moving
              ? this.spec.actor.clips.walk
              : this.spec.actor.clips.idle,
        );
    }
    this.mixers.forEach((m) => m.update(dt));
    this.actorMixer?.update(dt);
    this.mechanismController?.tick(dt, this.paused);
    if (this.moving && !this.spec.mechanism && !this.paused)
      for (const node of this.spec.nodes)
        if (node.joint) {
          const o = this.objects.get(node.id);
          if (o)
            o.rotation[node.joint.axis] =
              node.rotation[{ x: 0, y: 1, z: 2 }[node.joint.axis]] +
              (node.joint.min + node.joint.max) / 2 +
              (Math.sin(now / 1300) * (node.joint.max - node.joint.min)) / 2;
        }
    if (this.cameraTransition && !this.paused) {
      const t = THREE.MathUtils.clamp((now - this.cameraTransition.start) / 700, 0, 1),
        eased = t * t * (3 - 2 * t),
        transition = this.cameraTransition;
      this.camera.position.lerpVectors(transition.from, transition.to, eased);
      this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
      this.camera.up.lerpVectors(transition.fromUp, transition.toUp, eased).normalize();
      if (t === 1) this.cameraTransition = undefined;
    }
    if (!this.paused) updateOrbitControls(this.controls);
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
    this.cameraTransition = undefined;
    this.dragStart = new THREE.Vector2(event.clientX, event.clientY);
  };
  private pointerUp = (event: PointerEvent) => {
    if (
      this.mode === 'view' ||
      this.paused ||
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
    if (this.paused || this.mode === 'view') return;
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
  private blur = () => {
    this.keys.clear();
    this.setMovement({ x: 0, y: 0, jump: false });
  };
  resetProgress() {
    this.saves.reset(this.spec);
    this.story = initialStory();
    this.callbacks.onStory?.(this.story);
  }
  private setActorClip(name: string) {
    if (!this.actorMixer || !this.char) return;
    const clip = THREE.AnimationClip.findByName(this.char.object.animations, name);
    if (!clip) return;
    const action = this.actorMixer.clipAction(clip);
    if (action === this.actorAction) return;
    action.reset().fadeIn(0.18).play();
    this.actorAction?.fadeOut(0.18);
    this.actorAction = action;
  }
  setTransmissionSpeed(inputRpm: number) {
    this.mechanismController?.setSpeed(inputRpm);
  }
  setSection(enabled: boolean) {
    this.section = enabled;
    this.isolate(this.isolatedId);
    this.notifyMechanism();
  }
  getMechanismState(): MechanismViewState | undefined {
    const state = this.mechanismController?.snapshot();
    return state
      ? {
          ...state,
          section: this.section,
          explosion: this.explosion,
          hiddenSubsystems: [...this.hiddenSubsystems],
          isolatedSubsystem: this.isolatedSubsystem,
        }
      : undefined;
  }
  subscribeMechanism(listener: (state: MechanismViewState) => void) {
    this.mechanismListeners.add(listener);
    const state = this.getMechanismState();
    if (state) listener(state);
    return () => {
      this.mechanismListeners.delete(listener);
    };
  }
  private notifyMechanism() {
    const state = this.getMechanismState();
    if (state) this.mechanismListeners.forEach((listener) => listener(state));
  }
  resetMechanismMotion() {
    this.mechanismController?.resetMotion();
  }
  stepMechanism(radians: number) {
    this.mechanismController?.step(radians);
  }
  setBrakeInstalled(installed: boolean) {
    this.mechanismController?.setBrakeInstalled(installed);
    this.isolate(this.isolatedId);
    this.notifyMechanism();
  }
  setBrakePowered(powered: boolean) {
    this.mechanismController?.setBrakePowered(powered);
  }
  setSubsystemVisible(id: string, visible: boolean) {
    if (!this.spec.mechanism?.subsystems?.some((s) => s.id === id)) return;
    if (visible) this.hiddenSubsystems.delete(id);
    else this.hiddenSubsystems.add(id);
    this.isolate(this.isolatedId);
    this.notifyMechanism();
  }
  isolateSubsystem(id?: string) {
    if (id && !this.spec.mechanism?.subsystems?.some((s) => s.id === id)) return;
    this.isolatedSubsystem = id;
    if (id) this.hiddenSubsystems.delete(id);
    this.isolate(this.isolatedId);
    this.notifyMechanism();
  }
  setMechanismViewportInsets(insets: { top: number; bottom: number; left: number; right: number }) {
    if (Object.values(insets).every((v) => Number.isFinite(v) && v >= 0))
      this.mechanismInsets = { ...insets };
  }
  fitMechanismView(
    view: 'default' | 'front' | 'side' | 'top' | 'bottom' = this.mechanismView ?? 'default',
  ) {
    this.mechanismView = view;
    const bounds = new THREE.Box3();
    for (const [id, object] of this.objects) {
      if (this.spec.nodes.find((n) => n.id === id)?.kind !== 'mesh' || !this.objectVisible(object))
        continue;
      object.updateWorldMatrix(true, true);
      object.traverseVisible((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.computeBoundingBox();
          if (child.geometry.boundingBox)
            bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
        }
      });
    }
    if (bounds.isEmpty()) return;
    const { width, height } = this.container.getBoundingClientRect(),
      margin = this.mechanismInsets;
    const w = Math.max(width, 1),
      h = Math.max(height, 1);
    const usableW = Math.max(w * 0.2, w - margin.left - margin.right),
      usableH = Math.max(h * 0.2, h - margin.top - margin.bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const halfAngle = Math.atan(Math.min((tan * usableH) / h, (((tan * w) / h) * usableW) / w));
    const radius = Math.max(0.001, bounds.getSize(new THREE.Vector3()).length() / 2);
    const distance = (radius * 1.12) / Math.sin(halfAngle);
    const direction = new THREE.Vector3(
      ...({
        default: [1, 0.65, -1],
        front: [0, 0, -1],
        side: [1, 0, 0],
        top: [0, 1, 0],
        bottom: [0, -1, 0],
      }[view] as [number, number, number]),
    ).normalize();
    if (view === 'default') {
      const authored = new THREE.Vector3(...this.spec.camera.position).sub(
        new THREE.Vector3(...this.spec.camera.target),
      );
      if (authored.lengthSq() > 1e-12) direction.copy(authored.normalize());
    }
    const up = new THREE.Vector3(
      ...((Math.abs(direction.y) > 0.999 ? [0, 0, 1] : [0, 1, 0]) as [number, number, number]),
    );
    const right = up.clone().cross(direction).normalize();
    const actualUp = direction.clone().cross(right).normalize();
    const target = bounds.getCenter(new THREE.Vector3());
    const unitPerPixel = (2 * distance * tan) / h;
    target.addScaledVector(right, (-(margin.left - margin.right) / 2) * unitPerPixel);
    target.addScaledVector(actualUp, ((margin.top - margin.bottom) / 2) * unitPerPixel);
    this.cameraTransition = undefined;
    this.camera.up.copy(up);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.00001, distance / 1000);
    this.camera.far = Math.max(10, distance * 100);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.minDistance = 0.001;
    this.controls.maxDistance = Math.max(2, distance * 10);
    this.controls.maxPolarAngle = Math.PI;
    this.camera.lookAt(target);
    updateOrbitControls(this.controls);
  }
  resetMechanismPresentation() {
    this.hiddenSubsystems.clear();
    this.isolatedSubsystem = undefined;
    this.isolatedId = undefined;
    this.mechanismController?.setBrakeInstalled(true);
    this.mechanismController?.setSpeed(6);
    this.resetMechanismMotion();
    this.explode(0);
    this.setSection(false);
    this.fitMechanismView('default');
    this.notifyMechanism();
  }
  private applyMechanism(deform: boolean) {
    const m = this.spec.mechanism;
    if (!m) return;
    const state = harmonicState(this.inputAngle, this.inputRpm, m.flexTeeth, m.ringTeeth);
    for (const [id, angle] of [
      [m.waveNodeId, state.inputAngle],
      [m.flexNodeId, state.outputAngle],
      [m.outputNodeId, state.outputAngle],
    ] as const) {
      const object = this.objects.get(id),
        node = this.spec.nodes.find((n) => n.id === id);
      if (object && node) {
        object.rotation.set(...node.rotation);
        object.rotation.y += angle;
      }
    }
    this.objects.get(m.flexNodeId)?.traverse((o) => {
      if (o instanceof THREE.Mesh && o.morphTargetDictionary && o.morphTargetInfluences) {
        for (const [name, value] of [
          [m.cosMorph, state.cos],
          [m.sinMorph, state.sin],
        ] as const) {
          const index = o.morphTargetDictionary[name];
          if (index !== undefined) o.morphTargetInfluences[index] = deform ? value : 0;
        }
      }
    });
  }
  private clearContent() {
    for (const mixer of this.mixers) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    }
    this.mixers = [];
    if (this.actorSource) {
      disposeObject(this.actorSource);
      this.actorSource = undefined;
    }
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
    this.mechanismController?.dispose();
    this.mechanismListeners.clear();
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
    this.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
