import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AssetRegistry } from '@virtualworld/asset-runtime';

it('rebuilds Spark GPU state and awaits its update while retaining the authored SplatMesh', async () => {
  const created: FakeSpark[] = [];
  let complete!: () => void;
  class FakeSpark extends THREE.Object3D {
    dispose = vi.fn();
    update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    constructor() {
      super();
      created.push(this);
    }
  }
  class FakeSplat extends THREE.Object3D {
    dispose = vi.fn();
  }
  const registry = new AssetRegistry(
    undefined,
    async () => ({ SparkRenderer: FakeSpark, SplatMesh: FakeSplat }) as any,
  );
  const world = new THREE.Scene();
  const renderer = { getContext: () => ({ isContextLost: () => false }) } as any;
  await registry.prepareSplats(renderer, world);
  const splat = registry.createSplat({ url: 'retained.spz' } as any);
  world.add(splat);
  const recovery = registry.restoreGraphics(
    renderer,
    world,
    new THREE.PerspectiveCamera(),
    () => true,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(created[0].dispose).toHaveBeenCalledOnce();
  expect(created[1].update).toHaveBeenCalledOnce();
  await registry.prepareSplats(renderer, world);
  expect(created).toHaveLength(2);
  expect(world.children).toContain(splat);
  expect(splat.dispose).not.toHaveBeenCalled();
  complete();
  await recovery;
  expect(world.children).toContain(created[1]);
  registry.dispose();
});

it('disposes a pending replacement Spark renderer if a new context loss supersedes it', async () => {
  const disposed = vi.fn();
  let finish!: () => void;
  class FakeSpark extends THREE.Object3D {
    dispose = disposed;
    update() {
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
  }
  const registry = new AssetRegistry(undefined, async () => ({ SparkRenderer: FakeSpark }) as any);
  const world = new THREE.Scene();
  const renderer = { getContext: () => ({ isContextLost: () => false }) } as any;
  await registry.prepareSplats(renderer, world);
  let current = true;
  const recovery = registry.restoreGraphics(
    renderer,
    world,
    new THREE.PerspectiveCamera(),
    () => current,
  );
  await Promise.resolve();
  await Promise.resolve();
  current = false;
  registry.releaseGraphics();
  expect(disposed).toHaveBeenCalledTimes(2);
  finish();
  await recovery;
  expect(disposed).toHaveBeenCalledTimes(3);
  expect(world.children).toHaveLength(0);
  registry.dispose();
});

it('keeps a newer Spark restoration exclusively owned when the superseded update finishes late', async () => {
  const created: FakeSpark[] = [];
  const finishes: (() => void)[] = [];
  class FakeSpark extends THREE.Object3D {
    dispose = vi.fn();
    constructor() {
      super();
      created.push(this);
    }
    update() {
      return new Promise<void>((resolve) => finishes.push(resolve));
    }
  }
  const registry = new AssetRegistry(undefined, async () => ({ SparkRenderer: FakeSpark }) as any);
  const renderer = { getContext: () => ({ isContextLost: () => false }) } as any;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  await registry.prepareSplats(renderer, world);
  const old = registry.restoreGraphics(renderer, world, camera, () => true);
  await Promise.resolve();
  await Promise.resolve();
  const latest = registry.restoreGraphics(renderer, world, camera, () => true);
  await Promise.resolve();
  await Promise.resolve();
  expect(created).toHaveLength(2);
  finishes[0]();
  await old;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await registry.prepareSplats(renderer, world);
  expect(created).toHaveLength(3);
  expect(world.children).toHaveLength(0);
  finishes[1]();
  await latest;
  expect(world.children).toEqual([created[2]]);
  expect(created[1].dispose).toHaveBeenCalledTimes(2);
  registry.dispose();
});

it('cleans resources allocated after early disposal when a stale Spark update finally settles', async () => {
  const created: FakeSpark[] = [];
  const finishes: (() => void)[] = [];
  class FakeSpark extends THREE.Object3D {
    worker?: { dispose: () => void };
    texture?: THREE.DataTexture;
    lateWorkerDisposed = vi.fn();
    lateTextureDisposed = vi.fn();
    dispose = vi.fn(() => {
      this.worker?.dispose();
      this.worker = undefined;
      this.texture?.dispose();
      this.texture = undefined;
    });
    constructor(readonly options: { enableDriveLod?: boolean }) {
      super();
      created.push(this);
    }
    async update() {
      // Pinned Spark driveSort awaits GPU readback, then can allocate after dispose.
      await new Promise<void>((resolve) => finishes.push(resolve));
      this.worker = { dispose: this.lateWorkerDisposed };
      this.texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      this.texture.addEventListener('dispose', this.lateTextureDisposed);
    }
  }
  const registry = new AssetRegistry(undefined, async () => ({ SparkRenderer: FakeSpark }) as any);
  const renderer = { getContext: () => ({ isContextLost: () => false }) } as any;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  await registry.prepareSplats(renderer, world);
  const stale = registry.restoreGraphics(renderer, world, camera, () => true);
  await Promise.resolve();
  await Promise.resolve();
  const latest = registry.restoreGraphics(renderer, world, camera, () => true);
  await Promise.resolve();
  await Promise.resolve();
  expect(created[1].dispose).toHaveBeenCalledOnce();
  expect(created).toHaveLength(2);
  finishes[0]();
  await stale;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(created[1].lateWorkerDisposed).toHaveBeenCalledOnce();
  expect(created[1].lateTextureDisposed).toHaveBeenCalledOnce();
  expect(created[2].dispose).not.toHaveBeenCalled();
  finishes[1]();
  await latest;
  expect(world.children).toEqual([created[2]]);
  expect(created.every((spark) => spark.options.enableDriveLod === false)).toBe(true);
  registry.dispose();
});

it('can safely dispose the pinned Spark renderer again after late worker and texture allocation', async () => {
  const { SparkRenderer } = await import('@sparkjsdev/spark');
  // Stub only the GL-extension query; this creates no browser canvas or GPU context.
  const renderer = { getContext: () => ({ getExtension: () => null }) } as any;
  const spark = new SparkRenderer({ renderer, enableDriveLod: false });
  spark.dispose();
  const worker = { dispose: vi.fn() };
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const textureDisposed = vi.fn();
  texture.addEventListener('dispose', textureDisposed);
  spark.sortWorker = worker as any;
  spark.orderingTexture = texture;
  expect(() => spark.dispose()).not.toThrow();
  expect(worker.dispose).toHaveBeenCalledOnce();
  expect(textureDisposed).toHaveBeenCalledOnce();
  expect(spark.sortWorker).toBeNull();
  expect(spark.orderingTexture).toBeNull();
});

async function managedFixture() {
  const created: FakeSpark[] = [];
  const completions: { resolve: () => void; reject: (error: Error) => void }[] = [];
  class FakeSpark extends THREE.Object3D {
    dispose = vi.fn();
    update = vi.fn(
      () => new Promise<void>((resolve, reject) => completions.push({ resolve, reject })),
    );
    constructor(readonly options: { autoUpdate?: boolean; enableDriveLod?: boolean }) {
      super();
      created.push(this);
    }
  }
  const registry = new AssetRegistry(undefined, async () => ({ SparkRenderer: FakeSpark }) as any);
  const renderer = { getContext: () => ({ isContextLost: () => false }) } as any;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const splat = new THREE.Object3D();
  splat.userData.isSplat = true;
  Object.assign(splat, { version: 1, isInitialized: true, numSplats: 10 });
  world.add(splat);
  await registry.prepareSplats(renderer, world);
  const failure = vi.fn();
  const update = () => registry.updateGraphics(world, camera, failure);
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    registry,
    renderer,
    world,
    camera,
    splat,
    created,
    completions,
    failure,
    update,
    settle,
  };
}

it('owns normal Spark update rejection and reports it once without an unhandled promise', async () => {
  const f = await managedFixture();
  f.update();
  await f.settle();
  f.completions[0].reject(new Error('GPU readback interrupted'));
  await f.settle();
  expect(f.failure).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: 'GPU readback interrupted' }),
  );
  f.update();
  f.update();
  await f.settle();
  expect(f.created[0].update).toHaveBeenCalledOnce();
  expect(f.created[0].options).toMatchObject({ autoUpdate: false, enableDriveLod: false });
  f.registry.dispose();
});

it('coalesces pending camera changes and does not regenerate unchanged static splats', async () => {
  const f = await managedFixture();
  f.update();
  await f.settle();
  f.camera.position.x = 1;
  f.update();
  f.camera.position.x = 2;
  f.update();
  expect(f.created[0].update).toHaveBeenCalledOnce();
  f.completions[0].resolve();
  await f.settle();
  expect(f.created[0].update).toHaveBeenCalledTimes(2);
  f.completions[1].resolve();
  await f.settle();
  f.update();
  f.update();
  await f.settle();
  expect(f.created[0].update).toHaveBeenCalledTimes(2);
  f.registry.dispose();
});

it('refreshes normal Spark only after visible, world transform, version or initialization inputs change', async () => {
  const f = await managedFixture();
  f.update();
  await f.settle();
  f.completions[0].resolve();
  await f.settle();
  const changes = [
    () => {
      f.splat.visible = false;
    },
    () => {
      f.splat.position.y = 0.2;
    },
    () => {
      (f.splat as any).version++;
    },
    () => {
      (f.splat as any).isInitialized = false;
    },
  ];
  for (const [index, change] of changes.entries()) {
    change();
    f.update();
    await f.settle();
    expect(f.created[0].update).toHaveBeenCalledTimes(index + 2);
    f.completions[index + 1].resolve();
    await f.settle();
  }
  f.registry.dispose();
});

it('finally cleans late normal-update resources after retirement without affecting the new Spark owner', async () => {
  const f = await managedFixture();
  const old = f.created[0];
  let finish!: () => void;
  const lateResource = { dispose: vi.fn() };
  let allocated = false;
  old.update.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    allocated = true;
  });
  old.dispose.mockImplementation(() => {
    if (allocated) {
      lateResource.dispose();
      allocated = false;
    }
  });
  f.update();
  await f.settle();
  f.registry.releaseGraphics();
  await f.registry.prepareSplats(f.renderer, f.world);
  finish();
  await f.settle();
  expect(lateResource.dispose).toHaveBeenCalledOnce();
  expect(f.created[1].dispose).not.toHaveBeenCalled();
  expect(f.failure).not.toHaveBeenCalled();
  expect(f.world.children).toContain(f.created[1]);
  f.registry.dispose();
});

it('waits for a retired normal GPU update to settle before starting explicit recovery work', async () => {
  const f = await managedFixture();
  f.update();
  await f.settle();
  const restoring = f.registry.restoreGraphics(f.renderer, f.world, f.camera, () => true);
  await f.settle();
  expect(f.created).toHaveLength(1);
  f.completions[0].resolve();
  await f.settle();
  expect(f.created).toHaveLength(2);
  expect(f.created[1].update).toHaveBeenCalledOnce();
  f.completions[1].resolve();
  await restoring;
  expect(f.world.children).toContain(f.created[1]);
  f.registry.dispose();
});

it('includes parent visibility in normal static-splat GPU inputs', async () => {
  const f = await managedFixture();
  const parent = new THREE.Group();
  parent.add(f.splat);
  f.world.add(parent);
  f.update();
  await f.settle();
  f.completions[0].resolve();
  await f.settle();
  parent.visible = false;
  f.update();
  await f.settle();
  expect(f.created[0].update).toHaveBeenCalledTimes(2);
  f.completions[1].resolve();
  await f.settle();
  f.registry.dispose();
});

it('bounds a hung normal GPU update and reports only one failure before retirement', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = await managedFixture();
  try {
    f.update();
    await f.settle();
    await vi.advanceTimersByTimeAsync(15000);
    expect(f.failure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: '图形资源更新超时，请重试恢复。' }),
    );
    f.registry.releaseGraphics();
    f.completions[0].reject(new Error('late worker cancellation'));
    await f.settle();
    expect(f.failure).toHaveBeenCalledOnce();
  } finally {
    f.registry.dispose();
    vi.useRealTimers();
  }
});
