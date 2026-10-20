import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import { CharacterController } from '@virtualworld/interaction/character';
import { SaveSystem } from '@virtualworld/interaction';
import { node, type SceneSpec } from '@virtualworld/scene-schema';
import { StudioRuntime } from '@virtualworld/engine';
import { worldDemo } from '../fixtures/scenes';

function scene(id = 'actor-preview', previewId = 'prince') {
  const spec = worldDemo();
  spec.id = id;
  spec.spawn = [0, 0, 2];
  spec.assets = ['prince', 'pilot'].map((id) => ({
    id,
    name: id,
    type: 'glb',
    url: `/assets/optimized/${id}.glb`,
    bytes: 0,
  }));
  spec.nodes = [
    node('ground', 'Ground', 'box', [0, -0.5, 0], [30, 1, 30], '#ffffff', {
      collider: { shape: 'box', size: [30, 1, 30] },
    }),
    node(previewId, 'Little Prince', 'glb', [...spec.spawn], [1, 1, 1], '#ffffff', {
      assetId: 'prince',
      animation: { clip: 'Idle', loop: true },
    }),
    node('pilot', 'Pilot', 'glb', [-3, 0, -1], [1, 1, 1], '#ffffff', {
      assetId: 'pilot',
      animation: { clip: 'Idle', loop: true },
    }),
  ];
  const actor = {
    nodeId: previewId,
    assetId: 'prince',
    height: 1.6,
    clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
  };
  spec.actor = actor;
  spec.tasks = [];
  return spec;
}

function actorModel(url: string) {
  const root = new THREE.Group();
  root.name = url.includes('pilot') ? 'PilotRig' : 'PrinceRig';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 0.3), new THREE.MeshBasicMaterial());
  body.position.y = 1;
  root.add(body);
  root.animations = ['Idle', 'Walk', 'Interact'].map(
    (name) => new THREE.AnimationClip(name, 1, []),
  );
  return root;
}

function harness() {
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  const controls = new OrbitControls(camera, null);
  const assets = new AssetRegistry(async (url) => actorModel(url));
  Object.assign(runtime, {
    spec: scene(),
    world: new THREE.Scene(),
    objects: new Map(),
    content: new THREE.Group(),
    camera,
    controls,
    assets,
    saves: new SaveSystem(),
    transform: { detach() {} },
    renderer: {
      getContext: () => ({ isContextLost: () => false }),
      render() {},
      info: { render: { calls: 0, triangles: 0 } },
    },
    container: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) },
    callbacks: {},
    generation: 0,
    playRequest: 0,
    playing: false,
    disposed: false,
    mode: 'view',
    quality: 'balanced',
    paused: false,
    keys: new Set(),
    movement: { x: 0, y: 0, jump: false },
    mixers: [],
    hiddenSubsystems: new Set(),
    mechanismListeners: new Set(),
    metrics: { loading: false, errors: [] },
    last: 0,
    metricAt: 0,
    metricFrames: 0,
    interactUntil: 0,
    explosion: 0,
  });
  return {
    runtime,
    cleanup() {
      runtime.stop();
      (runtime as any).clearContent();
      assets.dispose();
      disposeObject(runtime.world);
    },
  };
}

function visibleActors(runtime: StudioRuntime, name: string) {
  const actors: THREE.Object3D[] = [];
  runtime.world.traverseVisible((object) => {
    if (object.name === name) actors.push(object);
  });
  return actors;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('normalizes the linked preview model to actor height while retaining its authored transform', async () => {
  const f = harness();
  const spec = scene();
  const authored = spec.nodes[1];
  authored.rotation = [0, 0.4, 0];
  authored.scale = [1.2, 1.1, 1.2];
  try {
    await f.runtime.load(spec);
    const preview = f.runtime.objects.get('prince')!;
    const model = preview.children[0];
    expect(model.scale.y).toBeCloseTo(0.8);
    expect(preview.position.toArray()).toEqual(authored.position);
    expect(preview.rotation.toArray().slice(0, 3)).toEqual(authored.rotation);
    expect(preview.scale.toArray()).toEqual(authored.scale);
    expect(f.runtime.objects.get('pilot')!.children[0].scale.y).toBe(1);
    expect(f.runtime.spec).toEqual(spec);
  } finally {
    f.cleanup();
  }
});

it('shows one Prince through play, movement, stop and re-entry while the pilot stays put', async () => {
  const f = harness();
  const spec = scene();
  try {
    await f.runtime.load(spec);
    const preview = f.runtime.objects.get('prince')!;
    const pilot = f.runtime.objects.get('pilot')!;
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    await f.runtime.play();
    expect(preview.visible).toBe(false);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    expect(visibleActors(f.runtime, 'PilotRig')).toHaveLength(1);
    expect(f.runtime.getDiagnostics().actorClip).toBe('Idle');
    const before = f.runtime.getDiagnostics().player!;
    f.runtime.setMovement({ x: 1, y: 0, jump: false });
    for (let frame = 1; frame <= 30; frame++) (f.runtime as any).renderFrame((frame * 1000) / 60);
    const after = f.runtime.getDiagnostics().player!;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(1);
    expect(f.runtime.getDiagnostics().actorClip).toBe('Walk');
    expect(preview.position.toArray()).toEqual(spec.nodes[1].position);
    expect(pilot.position.toArray()).toEqual(spec.nodes[2].position);
    f.runtime.stop();
    expect(preview.visible).toBe(true);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    expect(f.runtime.getDiagnostics().player).toBeUndefined();
    await f.runtime.play();
    expect(preview.visible).toBe(false);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    expect(f.runtime.spec).toEqual(spec);
  } finally {
    f.cleanup();
  }
});

it('keeps the preview hidden when isolation is changed during play', async () => {
  const f = harness();
  try {
    await f.runtime.load(scene());
    await f.runtime.play();
    f.runtime.isolate('prince');
    expect(f.runtime.objects.get('prince')!.visible).toBe(false);
    f.runtime.isolate();
    expect(f.runtime.objects.get('prince')!.visible).toBe(false);
    expect(f.runtime.objects.get('pilot')!.visible).toBe(true);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

it('shows the Prince after stopping when isolation was cleared during play', async () => {
  const f = harness();
  try {
    await f.runtime.load(scene());
    f.runtime.isolate('pilot');
    await f.runtime.play();
    f.runtime.isolate();
    expect(f.runtime.objects.get('prince')!.visible).toBe(false);
    f.runtime.stop();
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    expect(visibleActors(f.runtime, 'PilotRig')).toHaveLength(1);
    expect(f.runtime.spec.nodes.find((node) => node.id === 'prince')!.visible).toBe(true);
  } finally {
    f.cleanup();
  }
});

it('keeps the Prince hidden after stopping when the pilot was isolated during play', async () => {
  const f = harness();
  try {
    await f.runtime.load(scene());
    await f.runtime.play();
    f.runtime.isolate('pilot');
    expect(f.runtime.objects.get('prince')!.visible).toBe(false);
    f.runtime.stop();
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(0);
    expect(visibleActors(f.runtime, 'PilotRig')).toHaveLength(1);
    expect(f.runtime.spec.nodes.find((node) => node.id === 'prince')!.visible).toBe(true);
  } finally {
    f.cleanup();
  }
});

it('restores the old preview object when a different scene replaces a playing scene', async () => {
  const f = harness();
  try {
    await f.runtime.load(scene());
    const oldPreview = f.runtime.objects.get('prince')!;
    await f.runtime.play();
    expect(oldPreview.visible).toBe(false);
    await f.runtime.load(scene('next-scene', 'next-prince'));
    expect(oldPreview.visible).toBe(true);
    expect(f.runtime.objects.get('next-prince')!.visible).toBe(true);
    expect(f.runtime.getDiagnostics().player).toBeUndefined();
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    await f.runtime.play();
    expect(f.runtime.objects.get('next-prince')!.visible).toBe(false);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

it('leaves the preview visible when play is stopped before controller initialization finishes', async () => {
  const f = harness();
  const started = deferred<void>();
  const finish = deferred<void>();
  const create = CharacterController.create;
  vi.spyOn(CharacterController, 'create').mockImplementationOnce(async (...args) => {
    started.resolve();
    await finish.promise;
    return create(...args);
  });
  try {
    await f.runtime.load(scene());
    const playing = f.runtime.play();
    await started.promise;
    expect(f.runtime.objects.get('prince')!.visible).toBe(true);
    f.runtime.stop();
    finish.resolve();
    await playing;
    expect(f.runtime.objects.get('prince')!.visible).toBe(true);
    expect(f.runtime.getDiagnostics().player).toBeUndefined();
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
  } finally {
    finish.resolve();
    f.cleanup();
  }
});

it.each(['resolve', 'reject'] as const)(
  'keeps the current scene playing when an older controller initialization finishes with %s',
  async (outcome) => {
    const f = harness();
    const started = deferred<void>();
    const finish = deferred<void>();
    const create = CharacterController.create;
    vi.spyOn(CharacterController, 'create').mockImplementationOnce(async (...args) => {
      started.resolve();
      await finish.promise;
      return create(...args);
    });
    try {
      await f.runtime.load(scene());
      const oldPlay = f.runtime.play();
      await started.promise;
      await f.runtime.load(scene('next-scene', 'next-prince'));
      await f.runtime.play();
      const currentPlayer = f.runtime.getDiagnostics().player;
      if (outcome === 'resolve') finish.resolve();
      else finish.reject(new Error('Old character could not initialize'));
      await oldPlay;
      expect(f.runtime.getDiagnostics().player).toEqual(currentPlayer);
      expect(f.runtime.getDiagnostics().errors).toEqual([]);
      expect(f.runtime.objects.get('next-prince')!.visible).toBe(false);
      expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
    } finally {
      finish.resolve();
      f.cleanup();
    }
  },
);

it.each(['scene replacement', 'stop', 'stop and re-entry'] as const)(
  'does not resume a stale exploration mode change after %s',
  async (cancellation) => {
    const f = harness();
    const started = deferred<void>();
    const finish = deferred<void>();
    const create = CharacterController.create;
    let exploring: Promise<void> | undefined;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(CharacterController, 'create').mockImplementationOnce(async (...args) => {
      const controller = await create(...args);
      started.resolve();
      await finish.promise;
      return controller;
    });
    try {
      await f.runtime.load(scene());
      exploring = f.runtime.setMode('explore');
      await started.promise;
      if (cancellation === 'scene replacement') {
        const next = scene('next-scene', 'next-prince');
        next.camera = { position: [20, 12, 15], target: [3, 0, 2] };
        await f.runtime.load(next);
      } else {
        f.runtime.stop();
        if (cancellation === 'stop and re-entry') await f.runtime.setMode('explore');
      }
      const transition = (f.runtime as any).cameraTransition;
      const actor = (f.runtime as any).char;
      const camera = f.runtime.camera.position.toArray();
      const target = f.runtime.controls.target.toArray();
      finish.resolve();
      await exploring;
      expect((f.runtime as any).cameraTransition).toBe(transition);
      expect((f.runtime as any).char).toBe(actor);
      expect(f.runtime.camera.position.toArray()).toEqual(camera);
      expect(f.runtime.controls.target.toArray()).toEqual(target);
      if (cancellation === 'stop and re-entry') {
        expect(transition).toBeDefined();
        expect(actor).toBeDefined();
      } else {
        expect(transition).toBeUndefined();
        expect(f.runtime.getDiagnostics().player).toBeUndefined();
      }
    } finally {
      finish.resolve();
      await exploring;
      f.cleanup();
    }
  },
);

it('keeps the camera transition for a successful exploration mode change', async () => {
  const f = harness();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  try {
    await f.runtime.load(scene());
    const from = f.runtime.camera.position.toArray();
    const fromTarget = f.runtime.controls.target.toArray();
    await f.runtime.setMode('explore');
    const transition = (f.runtime as any).cameraTransition;
    expect(f.runtime.getDiagnostics().player).toBeDefined();
    expect(transition).toBeDefined();
    expect(transition.from.toArray()).toEqual(from);
    expect(transition.fromTarget.toArray()).toEqual(fromTarget);
    expect(transition.to.toArray()).toEqual(f.runtime.camera.position.toArray());
    expect(transition.toTarget.toArray()).toEqual(f.runtime.controls.target.toArray());
  } finally {
    f.cleanup();
  }
});

it('preserves legacy scenes that intentionally keep their actor separate from authored nodes', async () => {
  const f = harness();
  const spec: SceneSpec = scene();
  spec.actor = {
    assetId: 'prince',
    height: 1.6,
    clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
  };
  try {
    await f.runtime.load(spec);
    await f.runtime.play();
    expect(f.runtime.objects.get('prince')!.visible).toBe(true);
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(2);
    f.runtime.stop();
    expect(visibleActors(f.runtime, 'PrinceRig')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});
