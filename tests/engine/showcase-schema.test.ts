import { expect, it } from 'vitest';
import { assertScene, CampaignSchema } from '@virtualworld/scene-schema';
import { industrialDemo, worldDemo } from '@virtualworld/scene-builder';
import { readWorld } from '@virtualworld/scene-builder/io';
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
