import { expect, it } from 'vitest';
import { Group, Mesh, SphereGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { loadAnimatedGlb } from '@virtualworld/asset-runtime';
import { proceduralModel } from '../../generators/scene-builder/src/engine-export/assets';
import { createHash } from 'node:crypto';
import { CadJointView } from '../../packages/engine/src/cad-joint-view';
import { DEMO_JOINT_DYNAMICS, JointDynamics } from '@virtualworld/engine/joint-dynamics';
it('carries verified final node identities through GLB loading and actual mesh movement, restoring marker resources', async () => {
  const model = new Group();
  const ball = new Mesh(new SphereGeometry(0.002), new MeshStandardMaterial());
  ball.name = 'same';
  ball.geometry.translate(0.013, 0, 0.0221);
  model.add(ball);
  const bytes = await proceduralModel(model),
    hash = createHash('sha256').update(bytes).digest('hex');
  const loaded = await loadAnimatedGlb(
    'data:model/gltf-binary;base64,' + Buffer.from(bytes).toString('base64'),
  );
  expect(loaded.userData.glbSha256).toBe(hash);
  const mesh: Mesh[] = [];
  loaded.traverse((o) => {
    if (o instanceof Mesh) mesh.push(o);
  });
  expect(mesh[0].userData.gltfNodeIndex).toBeTypeOf('number');
  const config = {
    kind: 'cad-joint' as const,
    modelNodeId: 'model',
    sourceSha256: 'a'.repeat(64),
    modelSha256: hash,
    bindings: [
      {
        gltfNodeIndex: mesh[0].userData.gltfNodeIndex,
        originalPath: '/ball',
        role: 'ball' as const,
        center: [0.013, 0, 0.0221] as [number, number, number],
        pivot: [0, 0, 0.0221] as [number, number, number],
        axis: [0, 0, 1] as [number, number, number],
        bearingId: 'b',
      },
    ],
    bearings: [
      { id: 'b', innerSpeedFactor: 1, outerSpeedFactor: 0, pitchRadius: 0.013, ballRadius: 0.002 },
    ],
    gear: { status: 'unresolved' as const, notes: 'unknown' },
    dynamics: DEMO_JOINT_DYNAMICS,
    fixedNodeIds: [],
    fullHousingIds: [],
    sectionHousingIds: [],
    dimensions: {
      baseDiameter: 0.08,
      housingDiameter: 0.08,
      totalHeight: 0.098,
      boreDiameter: 0.01,
    },
  };
  const view = new CadJointView(loaded, config, new Group());
  const solver = new JointDynamics();
  solver.start();
  solver.tick(1);
  view.update(solver.snapshot().angle, 0, false);
  loaded.updateMatrixWorld(true);
  const position = new Vector3(0.013, 0, 0.0221).applyMatrix4(mesh[0].matrixWorld);
  expect(position.y).toBeGreaterThan(0);
  expect(position.z).toBeCloseTo(0.0221, 10);
  expect(Math.hypot(position.x, position.y)).toBeCloseTo(0.013, 10);
  view.setMarkers(true);
  expect(mesh[0].children.some((o) => o.name === 'rolling-marker')).toBe(true);
  view.dispose();
  expect(mesh[0].children.some((o) => o.name === 'rolling-marker')).toBe(false);
  expect(
    () => new CadJointView(loaded, { ...config, modelSha256: 'b'.repeat(64) }, new Group()),
  ).toThrow(/hash/i);
});
