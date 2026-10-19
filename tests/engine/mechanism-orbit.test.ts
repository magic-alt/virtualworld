import { expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  MechanismOrbitController,
  rotateMechanismCamera,
} from '../../packages/engine/src/mechanism-orbit';
import { updateOrbitControls } from '../../packages/engine/src/sphere-camera';

function fixture(
  direction: readonly [number, number, number] = [0, 0, -1],
  up: readonly [number, number, number] = [0, 1, 0],
) {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 100);
  const controls = new OrbitControls(camera, null);
  controls.target.set(0.5, 0.1, -0.4);
  camera.position
    .copy(controls.target)
    .add(new THREE.Vector3(...direction).normalize().multiplyScalar(3));
  camera.up.set(...up);
  camera.lookAt(controls.target);
  updateOrbitControls(controls);
  return { camera, controls };
}

it.each([
  ['default', [1, 0.65, -1], [0, 1, 0]],
  ['front', [0, 0, -1], [0, 1, 0]],
  ['side', [1, 0, 0], [0, 1, 0]],
  ['top', [0, 1, 0], [0, 0, 1]],
  ['bottom', [0, -1, 0], [0, 0, 1]],
] as const)(
  'rotates through 360 degrees in both axes without a dead zone from %s view',
  (_name, direction, up) => {
    const { camera, controls } = fixture(direction, up);
    const initialPosition = camera.position.clone();
    const initialUp = camera.up.clone();
    const length = camera.position.distanceTo(controls.target);
    const initialUpDot = camera.up.clone().normalize().dot(
      camera.position.clone().sub(controls.target).normalize(),
    );

    for (const [dx, dy] of [[0, 1], [1, 0]]) {
      const before = camera.position.clone();
      for (let step = 0; step < 72; step++) {
        const previous = camera.position.clone();
        rotateMechanismCamera(camera, controls, (dx * 900) / 72, (dy * 900) / 72, 900);
        expect(camera.position.distanceTo(previous)).toBeGreaterThan(0.2);
        expect(camera.position.distanceTo(controls.target)).toBeCloseTo(length, 9);
        expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
        expect(camera.up.toArray().every(Number.isFinite)).toBe(true);
        expect(
          camera.up.clone().normalize().dot(
            camera.position.clone().sub(controls.target).normalize(),
          ),
        ).toBeCloseTo(initialUpDot, 8);
      }
      expect(camera.position.distanceTo(before)).toBeLessThan(1e-7);
    }
    expect(camera.position.distanceTo(initialPosition)).toBeLessThan(1e-7);
    expect(camera.up.distanceTo(initialUp)).toBeLessThan(1e-7);
  },
);

it(
  'supports mouse, touch, pinch handoff, pause, scene switch and disposal without changing zoom/pan',
  () => {
    const { camera, controls } = fixture();
    const element = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ height: 600 }),
    }) as unknown as HTMLElement;
    let interactive = true;
    const orbit = new MechanismOrbitController(element, camera, controls, () => interactive);
    const pointer = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
      pointerType = 'mouse',
      buttons = 1,
    ) => {
      element.dispatchEvent(
        Object.assign(new Event(type), {
          pointerId,
          pointerType,
          clientX,
          clientY,
          button: 0,
          buttons,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false,
        }),
      );
    };
    orbit.setMechanismEnabled(true);
    expect(controls.enableRotate).toBe(false);
    expect(controls.enablePan).toBe(true);
    expect(controls.enableZoom).toBe(true);
    const initial = camera.position.clone();
    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 100, 200);
    expect(camera.position.distanceTo(initial)).toBeGreaterThan(1);
    pointer('pointerup', 1, 100, 200);
    const stopped = camera.position.clone();
    pointer('pointermove', 1, 100, 300);
    expect(camera.position.equals(stopped)).toBe(true);

    // Switching to a second touch cancels single-finger rotation until a fresh gesture.
    pointer('pointerdown', 2, 100, 100, 'touch');
    pointer('pointerdown', 3, 120, 100, 'touch');
    pointer('pointermove', 2, 100, 250, 'touch');
    expect(camera.position.equals(stopped)).toBe(true);
    pointer('pointerup', 3, 120, 100, 'touch');
    pointer('pointermove', 2, 100, 300, 'touch');
    expect(camera.position.equals(stopped)).toBe(true);
    pointer('pointerup', 2, 100, 300, 'touch');
    pointer('pointerdown', 4, 100, 100, 'touch', 0);
    pointer('pointermove', 4, 200, 100, 'touch', 0);
    expect(camera.position.equals(stopped)).toBe(false);
    pointer('pointerup', 4, 200, 100, 'touch', 0);

    // A cancelled or paused drag may not resume behind a dialog.
    const beforePause = camera.position.clone();
    pointer('pointerdown', 5, 100, 100);
    interactive = false;
    pointer('pointermove', 5, 100, 200);
    expect(camera.position.equals(beforePause)).toBe(true);
    orbit.cancel();
    interactive = true;
    pointer('pointermove', 5, 100, 300);
    expect(camera.position.equals(beforePause)).toBe(true);
    pointer('pointerup', 5, 100, 300);

    orbit.setMechanismEnabled(false);
    expect(controls.enableRotate).toBe(true);
    expect(controls.maxPolarAngle).toBeCloseTo(Math.PI * 0.49);
    pointer('pointerdown', 6, 100, 100);
    pointer('pointermove', 6, 100, 200);
    expect(camera.position.equals(beforePause)).toBe(true);
    pointer('pointerup', 6, 100, 200);
    orbit.dispose();
    orbit.setMechanismEnabled(false);
    pointer('pointerdown', 7, 100, 100);
    pointer('pointermove', 7, 100, 200);
    expect(camera.position.equals(beforePause)).toBe(true);
  },
);

it('ignores invalid drag dimensions and does not jump on malformed pointer deltas', () => {
  const { camera, controls } = fixture();
  const original = camera.position.clone();
  rotateMechanismCamera(camera, controls, NaN, 1, 900);
  rotateMechanismCamera(camera, controls, 1, 1, 0);
  rotateMechanismCamera(camera, controls, 0, 0, 900);
  expect(camera.position.equals(original)).toBe(true);
});
