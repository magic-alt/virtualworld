import { expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StudioRuntime } from '../../packages/engine/src/runtime';
import { worldDemo } from '@virtualworld/scene-builder';
import { updateOrbitControls } from '../../packages/engine/src/sphere-camera';

it.each(['x', 'z'] as const)(
  'keeps the camera outside the planet through a complete spherical walk about %s',
  (axis) => {
    const camera = new THREE.PerspectiveCamera();
    // No DOM is connected: this exercises real orbit math without event listeners.
    const controls = new OrbitControls(camera, null);
    controls.maxPolarAngle = Math.PI * 0.49;
    const feet = new THREE.Vector3(0, 6, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const rotationAxis = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    camera.position.set(0, 10, 7);
    controls.target.set(0, 7, 0);
    controls.update();
    for (let degree = 1; degree <= 360; degree++) {
      const previous = feet.clone();
      const previousUp = up.clone();
      up.set(0, 1, 0).applyAxisAngle(rotationAxis, (degree * Math.PI) / 180);
      feet.copy(up).multiplyScalar(6);
      camera.position
        .sub(previous)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousUp, up))
        .add(feet);
      camera.up.copy(up);
      controls.target.copy(feet).add(up);
      updateOrbitControls(controls);
      expect(camera.position.toArray().every(Number.isFinite), `finite at ${degree}`).toBe(true);
      expect(camera.position.length(), `outside at ${degree}`).toBeGreaterThan(6.25);
      expect(camera.position.clone().sub(feet).dot(up), `outward at ${degree}`).toBeGreaterThan(1);
    }
  },
);

it('reports the actual active actor clip', () => {
  const root = new THREE.Group();
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip('Walk', 1, []);
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  const spec = worldDemo();
  spec.nodes = [];
  Object.assign(runtime, {
    spec,
    container: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) },
    metrics: {},
    story: { flags: [], message: '', completed: false },
    actorAction: mixer.clipAction(clip),
  });
  expect(runtime.getDiagnostics().actorClip).toBe('Walk');
  mixer.uncacheRoot(root);
});
