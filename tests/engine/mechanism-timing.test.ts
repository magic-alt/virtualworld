import { expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MechanismController } from '../../packages/engine/src/mechanism';
import { StudioRuntime } from '../../packages/engine/src/runtime';

// Only the GPU boundary is stubbed; real renderFrame, controller and orbit controls run.
function runtime() {
  const camera = new PerspectiveCamera();
  const controller = new MechanismController({ flexTeeth: 200, ringTeeth: 202, hasBrake: true });
  controller.setMoving(true);
  const r = Object.create(StudioRuntime.prototype) as any;
  Object.assign(r, {
    camera,
    world: new Scene(),
    controls: new OrbitControls(camera),
    mechanismController: controller,
    renderer: { getContext: () => ({ isContextLost: () => false }), render: () => {} },
    assets: { updateGraphics: () => {} },
    mixers: [],
    paused: false,
    last: 1000,
    metricFrames: 0,
    metricAt: Infinity,
    spec: { mechanism: { kind: 'harmonic' } },
    callbacks: {},
  });
  return { r, controller };
}
it.each([60, 20, 10, 5])(
  'advances exactly one input turn in ten seconds at %i fps through the real render loop',
  (fps) => {
    const { r, controller } = runtime();
    for (let frame = 1; frame <= 10 * fps; frame++) r.renderFrame(1000 + (frame * 1000) / fps);
    expect(controller.snapshot().inputAngle).toBeCloseTo(2 * Math.PI, 8);
    expect(controller.snapshot().outputAngle).toBeCloseTo(-Math.PI / 50, 8);
    controller.dispose();
  },
);
it('excludes paused wall time without slowing subsequent reverse motion', () => {
  const { r, controller } = runtime();
  controller.setSpeed(-6);
  r.renderFrame(1100);
  const before = controller.snapshot().inputAngle;
  r.paused = true;
  r.renderFrame(11100);
  expect(controller.snapshot().inputAngle).toBe(before);
  expect(controller.snapshot().actualInputRpm).toBe(0);
  r.paused = false;
  r.renderFrame(11200);
  expect(controller.snapshot().inputAngle - before).toBeCloseTo(-Math.PI / 50, 8);
  controller.dispose();
});
