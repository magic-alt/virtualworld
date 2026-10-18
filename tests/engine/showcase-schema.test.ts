import { expect, it } from 'vitest';
import { assertScene, CampaignSchema, node } from '@virtualworld/scene-schema';
import { worldDemo } from '../fixtures/scenes';
import { industrialDemo } from '../fixtures/scenes';
import { readWorld } from '@virtualworld/scene-builder/io';
it('accepts optional subsystem descriptions and rejects dangling or ambiguous memberships', async () => {
  const scene = await readWorld('worlds/demo-harmonic-joint');
  const legacy = structuredClone(scene);
  delete legacy.mechanism!.subsystems;
  expect(assertScene(legacy).mechanism).toBeDefined();
  const subsystem = {
    id: 'motor',
    name: '电机',
    description: '无框力矩电机',
    nodeIds: [scene.mechanism!.fixedNodeIds[0]],
  };
  scene.mechanism!.subsystems = [subsystem];
  expect(assertScene(scene).mechanism!.subsystems).toHaveLength(1);
  const groupMember = structuredClone(scene);
  groupMember.mechanism!.subsystems![0].nodeIds = [scene.mechanism!.waveNodeId];
  expect(() => assertScene(groupMember)).toThrow('叶子网格');
  const nestedMember = structuredClone(scene);
  nestedMember.nodes.push(
    node('nested-view-part', 'Nested part', 'box', [0, 0, 0], [0.001, 0.001, 0.001], '#ffffff', {
      parentId: subsystem.nodeIds[0],
    }),
  );
  expect(() => assertScene(nestedMember)).toThrow('叶子网格');
  for (const subsystems of [
    [{ ...subsystem, nodeIds: ['missing'] }],
    [subsystem, { ...subsystem, nodeIds: [scene.mechanism!.waveNodeId] }],
    [subsystem, { ...subsystem, id: 'another' }],
  ]) {
    expect(() =>
      assertScene({ ...scene, mechanism: { ...scene.mechanism, subsystems } }),
    ).toThrow();
  }
});
it('accepts legacy scenes but rejects invalid sphere/actor/mechanism references', () => {
  expect(assertScene(worldDemo()).version).toBe(1);
  expect(() =>
    assertScene({ ...worldDemo(), navigation: { kind: 'sphere', center: [0, 0, 0], radius: -1 } }),
  ).toThrow();
  expect(() =>
    assertScene({
      ...worldDemo(),
      actor: {
        assetId: 'missing',
        height: 1.2,
        clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
      },
    }),
  ).toThrow();
  expect(() =>
    assertScene({
      ...industrialDemo(),
      mechanism: {
        kind: 'harmonic',
        waveNodeId: 'missing',
        flexNodeId: 'missing',
        outputNodeId: 'shaft',
        fixedNodeIds: ['housing'],
        flexTeeth: 200,
        ringTeeth: 200,
        cosMorph: 'WaveCos',
        sinMorph: 'WaveSin',
        fullHousingIds: [],
        sectionHousingIds: [],
        dimensions: {
          baseDiameter: 0.215,
          housingDiameter: 0.18,
          totalHeight: 0.165,
          boreDiameter: 0.02,
        },
      },
    }),
  ).toThrow();
});
it('rejects moving/fixed ancestry overlaps and impossible mechanism envelopes', async () => {
  const scene = await readWorld('worlds/demo-harmonic-joint');
  const nested = structuredClone(scene);
  nested.nodes.find((n) => n.id === nested.mechanism!.fixedNodeIds[0])!.parentId =
    nested.mechanism!.waveNodeId;
  expect(() => assertScene(nested)).toThrow();
  const doubled = structuredClone(scene);
  doubled.nodes.find((n) => n.id === doubled.mechanism!.outputNodeId)!.parentId =
    doubled.mechanism!.flexNodeId;
  expect(() => assertScene(doubled)).toThrow();
  const envelope = structuredClone(scene);
  envelope.mechanism!.dimensions.boreDiameter = 1;
  expect(() => assertScene(envelope)).toThrow();
});
it('validates chapter identities, ordering and paths before discovery/export', () => {
  expect(() =>
    CampaignSchema.parse({
      version: 1,
      id: 'book',
      title: 'Book',
      description: '',
      chapters: [{ id: 'one', title: 'One', directory: '../secret' }],
    }),
  ).toThrow();
  expect(() =>
    CampaignSchema.parse({
      version: 1,
      id: 'book',
      title: 'Book',
      description: '',
      chapters: [
        { id: 'one', title: 'One', directory: 'chapters/one', requires: ['later'] },
        { id: 'later', title: 'Later', directory: 'chapters/later' },
      ],
    }),
  ).toThrow();
});
