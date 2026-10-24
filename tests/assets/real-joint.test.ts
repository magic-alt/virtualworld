import { expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { createHash } from 'node:crypto';
import { emptyScene, node, type CadMechanism } from '@virtualworld/scene-schema';
import { DEMO_JOINT_DYNAMICS } from '@virtualworld/engine/joint-dynamics';
import { inspectCadGlb, prepareRealJoint } from '@virtualworld/scene-builder/real-joint';
import { proceduralModel } from '../../generators/scene-builder/src/engine-export/assets';

it('binds final serialized identities despite duplicate names and preserves original geometry and units', async () => {
  const group = new Group();
  for (const x of [-0.013, 0.013]) {
    const sphere = new Mesh(new SphereGeometry(0.0016666667, 24, 16), new MeshStandardMaterial());
    sphere.name = '';
    sphere.position.set(x, 0, 0.0221);
    group.add(sphere);
  }
  const bytes = await proceduralModel(group),
    digest = createHash('sha256').update(bytes).digest('hex');
  const inventory = await inspectCadGlb(bytes);
  expect(inventory.meshes).toHaveLength(2);
  expect(new Set(inventory.meshes.map((m) => m.path)).size).toBe(2);
  expect(inventory.size[0]).toBeCloseTo(0.0293333334, 7);
  expect(inventory.meshes[0].sphere!.radius).toBeCloseTo(0.0016666667, 9);
  expect(inventory.meshes[0].sphere!.center[0]).toBeCloseTo(-0.013, 8);
  const scene = emptyScene();
  scene.assets.push({
    id: 'cad',
    type: 'glb',
    name: 'CAD',
    url: '/assets/optimized/cad.glb',
    bytes: bytes.length,
  });
  scene.nodes.push(
    node('cad-model', 'CAD', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
      assetId: 'cad',
      materialOverride: false,
      rotation: [-Math.PI / 2, 0, 0],
    }),
  );
  const original = JSON.stringify(scene);
  const mechanism: CadMechanism = {
    kind: 'cad-joint' as const,
    modelNodeId: 'cad-model',
    sourceSha256: 'a'.repeat(64),
    modelSha256: digest,
    bindings: inventory.meshes.map((m) => ({
      gltfNodeIndex: m.gltfNodeIndex,
      originalPath: m.path,
      role: 'ball' as const,
      pivot: [0, 0, 0.0221],
      axis: [0, 0, 1],
      center: m.sphere!.center,
      bearingId: 'b',
    })),
    bearings: [
      {
        id: 'b',
        innerSpeedFactor: 1,
        outerSpeedFactor: 0,
        pitchRadius: 0.013,
        ballRadius: 0.0016666667,
      },
    ],
    gear: { status: 'unresolved' as const, notes: 'No tooth details' },
    dynamics: DEMO_JOINT_DYNAMICS,
    fixedNodeIds: [],
    fullHousingIds: [],
    sectionHousingIds: [],
    dimensions: {
      baseDiameter: 0.08,
      housingDiameter: 0.08,
      totalHeight: 0.098161,
      boreDiameter: 0.01,
    },
  };
  const result = await prepareRealJoint(scene, bytes, mechanism);
  expect(result.scene.mechanism?.kind).toBe('cad-joint');
  expect(result.scene.revision).toBe(scene.revision + 1);
  expect(JSON.stringify(scene)).toBe(original);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  expect(result.scene.nodes).toEqual(scene.nodes);
  expect(result.report.modelSha256).toBe(digest);
  await expect(
    prepareRealJoint(scene, bytes, { ...mechanism, modelSha256: 'b'.repeat(64) }),
  ).rejects.toThrow(/hash/i);
  await expect(
    prepareRealJoint(scene, bytes, {
      ...mechanism,
      bindings: [{ ...mechanism.bindings[0], gltfNodeIndex: 9999 }],
    }),
  ).rejects.toThrow(/node/i);
  await expect(
    prepareRealJoint(scene, bytes, {
      ...mechanism,
      bindings: [{ ...mechanism.bindings[0], originalPath: 'stale/name' }],
    }),
  ).rejects.toThrow(/path/i);
  expect(JSON.stringify(scene)).toBe(original);
});
