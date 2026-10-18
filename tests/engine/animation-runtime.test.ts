import { it, expect } from 'vitest';
import * as THREE from 'three';
import { StudioRuntime } from '../../packages/engine/src/runtime';
it('cancels play waiting for asset readiness when stopped', async () => {
  let finish!: () => void;
  const loaded = new Promise<void>((resolve) => (finish = resolve));
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  Object.assign(runtime, {
    playing: false,
    playRequest: 0,
    generation: 1,
    disposed: false,
    loadComplete: loaded,
    keys: new Set(),
    camera: new THREE.PerspectiveCamera(),
    controls: { enablePan: false, maxDistance: 20 },
    spec: { nodes: [] },
  });
  const playing = runtime.play();
  runtime.stop();
  finish();
  await playing;
  expect((runtime as any).playing).toBe(false);
  expect((runtime as any).char).toBeUndefined();
});
