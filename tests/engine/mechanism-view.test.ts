import { it, expect } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StudioRuntime } from '@virtualworld/engine';
import { MechanismController } from '../../packages/engine/src/mechanism';
import { node } from '@virtualworld/scene-schema';
import { industrialDemo } from '../fixtures/scenes';

function fixture() {
  const spec = industrialDemo();
  spec.nodes = ['wave', 'flex', 'output', 'full', 'section', 'brake'].map((id) =>
    node(id, id, 'box', [0, 0, 0], [0.1, 0.1, 0.1], '#fff', { visible: id !== 'section' }),
  );
  spec.mechanism = {
    kind: 'harmonic',
    waveNodeId: 'wave',
    flexNodeId: 'flex',
    outputNodeId: 'output',
    fixedNodeIds: ['full', 'brake'],
    flexTeeth: 200,
    ringTeeth: 202,
    cosMorph: 'WaveCos',
    sinMorph: 'WaveSin',
    fullHousingIds: ['full'],
    sectionHousingIds: ['section'],
    dimensions: {
      baseDiameter: 0.11,
      housingDiameter: 0.1,
      totalHeight: 0.11,
      boreDiameter: 0.018,
    },
    subsystems: [
      { id: 'housing', name: '壳体', description: '固定壳', nodeIds: ['full', 'section'] },
      { id: 'brake', name: '抱闸', description: '选配', nodeIds: ['brake'], optional: 'brake' },
    ],
  };
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  const camera = new THREE.PerspectiveCamera(42, 390 / 844, 0.001, 100);
  Object.assign(runtime, {
    spec,
    objects: new Map(),
    camera,
    controls: new OrbitControls(camera, null),
    container: { getBoundingClientRect: () => ({ width: 390, height: 844 }) },
    mechanismController: new MechanismController({
      flexTeeth: 200,
      ringTeeth: 202,
      hasBrake: true,
    }),
    mechanismListeners: new Set(),
    hiddenSubsystems: new Set(),
    section: false,
    explosion: 0,
  });
  for (const n of spec.nodes) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    mesh.visible = n.visible;
    runtime.objects.set(n.id, mesh);
  }
  return runtime;
}
it('orbits smoothly after switching to top view with the actual pinned OrbitControls', () => {
  const r = fixture();
  r.setMechanismViewportInsets({ top: 0, bottom: 0, left: 0, right: 0 });
  r.fitMechanismView('top');
  (r.controls as any)._rotateLeft(Math.PI / 2);
  r.controls.update();
  const direction = r.camera.position.clone().sub(r.controls.target).normalize();
  expect(Math.abs(direction.x)).toBeGreaterThan(0.95);
});
it('composes optional parts, cutaway variants and subsystem isolation without editing the scene', () => {
  const r = fixture(),
    saved = JSON.stringify(r.spec);
  expect(r.setSubsystemVisible).toBeTypeOf('function');
  r.setSection(true);
  r.setSubsystemVisible('housing', false);
  expect(r.objects.get('section')!.visible).toBe(false);
  r.isolateSubsystem('brake');
  expect(r.objects.get('brake')!.visible).toBe(true);
  expect(r.objects.get('wave')!.visible).toBe(false);
  r.setBrakeInstalled(false);
  expect(r.objects.get('brake')!.visible).toBe(false);
  r.isolateSubsystem();
  r.setSubsystemVisible('housing', true);
  expect(r.objects.get('section')!.visible).toBe(true);
  expect(r.objects.get('full')!.visible).toBe(false);
  expect(JSON.stringify(r.spec)).toBe(saved);
});
it('fits visible exploded geometry inside a narrow viewport safe area and preserves finite cameras when all parts are hidden', () => {
  const r = fixture();
  expect(r.fitMechanismView).toBeTypeOf('function');
  r.objects.get('wave')!.position.y = 0.3;
  r.setMechanismViewportInsets({ top: 120, bottom: 290, left: 16, right: 16 });
  r.fitMechanismView('front');
  r.camera.updateMatrixWorld(true);
  for (const object of r.objects.values()) {
    if (!object.visible) continue;
    object.updateMatrixWorld(true);
    for (const corner of new THREE.Box3()
      .setFromObject(object)
      .getBoundingSphere(new THREE.Sphere())
      .center.toArray())
      expect(Number.isFinite(corner)).toBe(true);
    const box = new THREE.Box3().setFromObject(object);
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(r.camera);
          expect((1 - point.y) * 422).toBeGreaterThan(120);
          expect((1 - point.y) * 422).toBeLessThan(554);
          expect(Math.abs(point.x)).toBeLessThan(1);
        }
  }
  for (const o of r.objects.values()) o.visible = false;
  r.fitMechanismView('top');
  expect(r.camera.position.toArray().every(Number.isFinite)).toBe(true);
});

it('shows the underside output face and preserves orbit orientation after bottom view', () => {
  const r = fixture();
  r.setMechanismViewportInsets({ top: 0, bottom: 0, left: 0, right: 0 });
  r.fitMechanismView('bottom');
  expect(r.camera.position.clone().sub(r.controls.target).normalize().y).toBeLessThan(-0.99);
  (r.controls as any)._rotateLeft(Math.PI / 2);
  r.controls.update();
  expect(Math.abs(r.camera.position.clone().sub(r.controls.target).normalize().x)).toBeGreaterThan(
    0.95,
  );
});

it('uses the authored default camera direction when fitting the mechanism', () => {
  const r = fixture();
  r.spec.camera = { position: [0.19, -0.1, -0.22], target: [0, 0.042, 0] };
  r.setMechanismViewportInsets({ top: 0, bottom: 0, left: 0, right: 0 });
  r.fitMechanismView('default');
  const actual = r.camera.position.clone().sub(r.controls.target).normalize();
  const expected = new THREE.Vector3(0.19, -0.142, -0.22).normalize();
  expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
});

it('frames vertical authored defaults with a finite nonparallel up basis and asymmetric insets', () => {
  for (const y of [-1, 1]) {
    const r = fixture();
    r.spec.camera = { position: [0, y, 0], target: [0, 0, 0] };
    r.setMechanismViewportInsets({ top: 120, bottom: 290, left: 0, right: 0 });
    r.fitMechanismView('default');
    expect(r.camera.up.toArray()).toEqual([0, 0, 1]);
    expect(r.controls.target.z).toBeLessThan(0);
    expect(r.camera.position.toArray().every(Number.isFinite)).toBe(true);
  }
});
