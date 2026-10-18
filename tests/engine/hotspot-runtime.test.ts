import { expect, it } from 'vitest';
import * as THREE from 'three';
import { StudioRuntime } from '../../packages/engine/src/runtime';
import { worldDemo } from '../fixtures/scenes';
it('projects empty planar interaction anchors to finite visible screen coordinates', () => {
  const spec = worldDemo();
  spec.nodes = [
    {
      ...spec.nodes[0],
      id: 'anchor',
      kind: 'group',
      shape: undefined,
      interaction: { title: 'Meet', text: 'Hello' },
      position: [0, 1, 0],
    },
  ];
  const object = new THREE.Group();
  object.position.set(0, 1, 0);
  object.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(42, 1280 / 720, 0.05, 500);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  Object.assign(runtime, {
    spec,
    camera,
    objects: new Map([['anchor', object]]),
    container: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) },
    metrics: {},
    story: { flags: [], message: '', completed: false },
  });
  const [anchor] = runtime.getDiagnostics().hotspots!;
  expect(anchor).toBeDefined();
  expect(Number.isFinite(anchor.x) && Number.isFinite(anchor.y)).toBe(true);
  expect(anchor.x).toBeGreaterThan(0);
  expect(anchor.x).toBeLessThan(1280);
  expect(anchor.y).toBeGreaterThan(0);
  expect(anchor.y).toBeLessThan(720);
});
