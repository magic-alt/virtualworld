import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { primitive } from '@virtualworld/engine/geometry';
import { emptyScene, node, type CampaignSpec, type SceneSpec } from '@virtualworld/scene-schema';
import { assembleWorld } from '@virtualworld/scene-builder';
import {
  writeEngineExport,
  type EngineExportOptions,
  type EngineTarget,
} from '@virtualworld/scene-builder/engine-export';
import { validTriangleGlb } from '../fixtures/glb';

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
function princeChapter(chapter: string): SceneSpec {
  const root = `worlds/little-prince/chapters/${chapter}`;
  return assembleWorld(
    readJson(`${root}/scene.json`),
    readJson(`${root}/story.json`),
    readJson(`${root}/assets.json`),
  );
}
async function collect(
  scenes: SceneSpec[],
  target: EngineTarget = 'unity',
  overrides: Partial<EngineExportOptions> = {},
) {
  const files = new Map<string, Uint8Array>();
  await writeEngineExport({
    target,
    scenes,
    entrySceneId: scenes[0].id,
    primitiveFactory: primitive,
    assetBytes: (url) => readFileSync(new URL(`../..${url}`, import.meta.url)),
    ...overrides,
    emit: (path, bytes) => {
      overrides.emit?.(path, bytes);
      files.set(path, bytes);
    },
  });
  return { files, manifest: JSON.parse(decode(files.get('engine-manifest.json'))) };
}
function withActor(bytes: Uint8Array, id = 'actor-only'): SceneSpec {
  const scene = emptyScene('world');
  scene.id = id;
  scene.assets = [
    {
      id: 'prince',
      name: 'Prince',
      type: 'glb',
      url: `assets/${id}.glb`,
      bytes: bytes.byteLength,
    },
  ];
  scene.actor = {
    assetId: 'prince',
    height: 1.6,
    clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
  };
  return scene;
}
function campaignFixture(): { campaign: CampaignSpec; scenes: SceneSpec[] } {
  const campaign: CampaignSpec = {
    version: 1,
    id: 'prince-journey',
    title: 'Prince journey',
    description: '',
    chapters: [
      { id: 'desert', title: 'Desert', directory: 'chapters/desert' },
      { id: 'earth', title: 'Earth', directory: 'chapters/earth', requires: ['desert'] },
    ],
  };
  const scenes = campaign.chapters.map((chapter, index) => {
    const scene = emptyScene('world');
    scene.id = chapter.id;
    scene.campaign = { id: campaign.id, chapterId: chapter.id, index };
    return scene;
  });
  return { campaign, scenes };
}
async function animatedGlb(): Promise<Uint8Array> {
  const document = await new NodeIO().readBinary(await validTriangleGlb());
  const buffer = document.getRoot().listBuffers()[0];
  const sampler = document
    .createAnimationSampler()
    .setInput(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Float32Array([0, 1]))
        .setBuffer(buffer),
    )
    .setOutput(
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 0, 0, 1, 0]))
        .setBuffer(buffer),
    );
  document
    .createAnimation('Walk')
    .addSampler(sampler)
    .addChannel(
      document
        .createAnimationChannel()
        .setTargetNode(document.getRoot().listNodes()[0])
        .setTargetPath('translation')
        .setSampler(sampler),
    );
  return new NodeIO().writeBinary(document);
}

describe('native runtime export contract', () => {
  for (const target of ['unity', 'unreal'] as const) {
    it.each(['b612', 'earth'])(
      `${target} exports the untouched actor GLB for the actual %s chapter without an actor node`,
      async (chapter) => {
        const scene = princeChapter(chapter);
        const originalScene = structuredClone(scene);
        const actor = scene.assets.find((asset) => asset.id === scene.actor!.assetId)!;
        const originalBytes = readFileSync(new URL(`../..${actor.url}`, import.meta.url));
        expect(scene.nodes.some((node) => node.assetId === actor.id)).toBe(false);

        const { files, manifest } = await collect([scene], target);
        const binding = manifest.scenes[0].actorModel;
        expect(binding).toBe(sha256(originalBytes));
        expect(
          manifest.assets.filter((asset: { id: string }) => asset.id === binding),
        ).toHaveLength(1);
        const exported = manifest.assets.find((asset: { id: string }) => asset.id === binding);
        expect(exported.sha256).toBe(binding);
        expect(exported.bytes).toBe(originalBytes.byteLength);
        expect(Buffer.from(files.get(exported.path)!).equals(originalBytes)).toBe(true);
        expect(manifest.scenes[0].metadata.actor).toEqual(scene.actor);
        expect(manifest.scenes[0].nodes).toHaveLength(scene.nodes.length);
        expect(scene).toEqual(originalScene);
        expect(
          readFileSync(new URL(`../..${actor.url}`, import.meta.url)).equals(originalBytes),
        ).toBe(true);
      },
    );
  }

  it('deduplicates the actor, authored preview and identical cross-scene models by their whole GLB bytes', async () => {
    const bytes = await validTriangleGlb();
    const scenes = [withActor(bytes, 'preview'), withActor(bytes, 'actor-only')];
    scenes[0].actor!.nodeId = 'actor-preview';
    scenes[0].nodes.push(
      node('actor-preview', 'Prince preview', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
        assetId: 'prince',
      }),
    );
    const original = structuredClone(scenes);
    const { files, manifest } = await collect(scenes, 'unity', { assetBytes: () => bytes });
    const hash = sha256(bytes);
    expect(manifest.scenes.map((scene: { actorModel: string }) => scene.actorModel)).toEqual([
      hash,
      hash,
    ]);
    expect(manifest.scenes[0].nodes[0].model).toBe(hash);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].sources.map((source: { sceneId: string }) => source.sceneId)).toEqual(
      ['preview', 'actor-only'],
    );
    expect([...files.keys()].filter((path) => path.startsWith('models/'))).toEqual([
      `models/${hash}.glb`,
    ]);
    expect(scenes).toEqual(original);
  });

  it('keeps the actor whole GLB separate from a material-edited preview model', async () => {
    const bytes = await validTriangleGlb();
    const original = Uint8Array.from(bytes);
    const scene = withActor(bytes);
    scene.actor!.nodeId = 'preview';
    scene.nodes.push(
      node('preview', 'Edited preview', 'glb', [0, 0, 0], [1, 1, 1], '#ff0000', {
        assetId: 'prince',
        materialOverride: true,
      }),
    );
    const { files, manifest } = await collect([scene], 'unity', { assetBytes: () => bytes });
    expect(manifest.scenes[0].actorModel).toBe(sha256(original));
    expect(manifest.scenes[0].nodes[0].model).not.toBe(manifest.scenes[0].actorModel);
    expect(manifest.assets).toHaveLength(2);
    expect(Uint8Array.from(files.get(`models/${sha256(original)}.glb`)!)).toEqual(original);
    expect(Uint8Array.from(bytes)).toEqual(original);
  });

  it.each(['unity', 'unreal'] as const)(
    'retains %s campaign prerequisites and the selected current chapter without changing version 1',
    async (target) => {
      const { campaign, scenes } = campaignFixture();
      const original = structuredClone({ campaign, scenes });
      const { manifest } = await collect(scenes, target, {
        campaign,
        entrySceneId: 'earth',
      });
      expect(manifest.version).toBe(1);
      expect(manifest.entrySceneId).toBe('earth');
      expect(manifest.campaign).toEqual(campaign);
      expect(manifest.scenes[1].metadata.campaign).toEqual(scenes[1].campaign);
      expect({ campaign, scenes }).toEqual(original);
    },
  );

  it.each([
    'missing chapter',
    'extra scene',
    'wrong campaign',
    'wrong index',
    'forward prerequisite',
  ])('rejects invalid campaign membership before emitting assets: %s', async (variant) => {
    const { campaign, scenes } = campaignFixture();
    if (variant === 'missing chapter') scenes.pop();
    if (variant === 'extra scene') scenes.push({ ...emptyScene(), id: 'orphan' });
    if (variant === 'wrong campaign') scenes[1].campaign!.id = 'different-campaign';
    if (variant === 'wrong index') scenes[1].campaign!.index = 0;
    if (variant === 'forward prerequisite') campaign.chapters[0].requires = ['earth'];
    const emitted: string[] = [];
    await expect(
      collect(scenes, 'unity', { campaign, emit: (path) => emitted.push(path) }).then(
        () => 'export completed',
      ),
    ).rejects.toThrow(/campaign|chapter/i);
    expect(emitted).toEqual([]);
  });

  it('exports a real Unreal project and identical canonical model and manifest mirrors', async () => {
    const bytes = await validTriangleGlb();
    const scene = withActor(bytes);
    scene.nodes.push(node('box', 'Box', 'box', [1, 2, 3], [1, 2, 1], '#abcdef'));
    const { files, manifest } = await collect([scene], 'unreal', { assetBytes: () => bytes });
    expect(manifest.target).toBe('unreal');
    expect([...files.keys()].filter((path) => path.endsWith('.uproject'))).toHaveLength(1);
    expect(
      [...files.keys()].some((path) => path.startsWith('Source/') && path.endsWith('.cpp')),
    ).toBe(true);
    for (const asset of manifest.assets) {
      const canonical = files.get(asset.path)!;
      expect(sha256(canonical)).toBe(asset.sha256);
      expect(files.get(`Content/VirtualWorldData/${asset.path}`)).toEqual(canonical);
    }
    expect(files.get('Content/VirtualWorldData/engine-manifest.json')).toEqual(
      files.get('engine-manifest.json'),
    );
    expect(manifest.runtime).toMatchObject({
      version: 1,
      implementation: 'native',
      validation: 'requires-engine',
    });
  });

  it.each(['models/', 'engine-manifest.json'])(
    'propagates caller budget errors from the Unreal %s mirror',
    async (suffix) => {
      const bytes = await validTriangleGlb();
      const emitted: string[] = [];
      const budgetError = new Error('native archive byte budget reached');
      await expect(
        collect([withActor(bytes)], 'unreal', {
          assetBytes: () => bytes,
          emit: (path) => {
            emitted.push(path);
            if (path.startsWith(`Content/VirtualWorldData/${suffix}`)) throw budgetError;
          },
        }),
      ).rejects.toBe(budgetError);
      expect(emitted.at(-1)).toMatch(new RegExp(`^Content/VirtualWorldData/${suffix}`));
    },
  );

  it('honors cancellation after the canonical Unreal model before writing its mirror', async () => {
    const bytes = await validTriangleGlb();
    const controller = new AbortController();
    const emitted: string[] = [];
    await expect(
      collect([withActor(bytes)], 'unreal', {
        assetBytes: () => bytes,
        signal: controller.signal,
        emit: (path) => {
          emitted.push(path);
          if (path.startsWith('models/')) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(emitted).toEqual([`models/${sha256(bytes)}.glb`]);
  });

  it.each(['unity', 'unreal'] as const)(
    '%s reports native validation gates while preserving selected-animation and unsupported-feature warnings',
    async (target) => {
      const bytes = await animatedGlb();
      const scene = withActor(bytes);
      scene.navigation = { kind: 'sphere', center: [0, 0, 0], radius: 4 };
      scene.environment.fog = 0.02;
      scene.tasks = [{ flag: 'talked', label: 'Speak with the prince' }];
      scene.assets.push({
        id: 'cloud',
        name: 'Cloud',
        type: 'splat',
        url: 'assets/cloud.ply',
        bytes: 0,
      });
      scene.nodes.push(
        node('story', 'Story', 'box', [0, 4, 0], [1, 1, 1], '#ffffff', {
          kind: 'group',
          interaction: { title: 'Speak', text: 'Hello', gives: 'talked' },
          joint: { axis: 'y', min: 0, max: 1, value: 0, confirmed: true },
        }),
        node('selected', 'Selected animated mesh', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
          assetId: 'prince',
          assetNode: '0',
          animation: { clip: 'Walk' },
        }),
        node('animated', 'Whole animated actor', 'glb', [2, 0, 0], [1, 1, 1], '#ffffff', {
          assetId: 'prince',
          animation: { clip: 'Walk', loop: false, speed: 0.5 },
        }),
        node('cloud', 'Splat', undefined, [0, 0, 0], [1, 1, 1], '#ffffff', {
          kind: 'splat',
          assetId: 'cloud',
        }),
      );
      const { files, manifest } = await collect([scene], target, { assetBytes: () => bytes });
      expect(manifest.runtime?.validation).toBe('requires-engine');
      expect(manifest.runtime?.features).toContain('node-animation');
      expect(
        manifest.compatibility.some(
          (finding: { code: string }) => finding.code === 'CHARACTER_JUMP_UNMAPPED',
        ),
      ).toBe(target === 'unreal');
      expect(manifest.compatibility).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NATIVE_RUNTIME_REQUIRES_VALIDATION',
            feature: 'scene gameplay',
          }),
          expect.objectContaining({
            code: 'NATIVE_RUNTIME_REQUIRES_VALIDATION',
            feature: 'spherical navigation',
          }),
          expect.objectContaining({
            code: 'NATIVE_RUNTIME_REQUIRES_VALIDATION',
            feature: 'node interaction',
            nodeId: 'story',
          }),
          expect.objectContaining({
            code: 'GAMEPLAY_UNMAPPED',
            feature: 'joint control',
            nodeId: 'story',
          }),
          expect.objectContaining({ code: 'ASSETNODE_ANIMATION_UNMAPPED', nodeId: 'selected' }),
          expect.objectContaining({
            code: 'NATIVE_RUNTIME_REQUIRES_VALIDATION',
            feature: 'animation playback',
            nodeId: 'animated',
          }),
          expect.objectContaining({ code: 'SPLAT_UNSUPPORTED', nodeId: 'cloud' }),
          expect.objectContaining({ code: 'FOG_APPROXIMATION' }),
        ]),
      );
      expect(
        manifest.compatibility.some(
          (finding: { code: string }) => finding.code === 'SPHERICAL_NAVIGATION_UNMAPPED',
        ),
      ).toBe(false);
      expect(JSON.parse(decode(files.get('compatibility.json'))).findings).toEqual(
        manifest.compatibility,
      );
    },
  );

  it('preserves Godot unmapped gameplay warnings and does not declare a native gameplay runtime', async () => {
    const bytes = await validTriangleGlb();
    const scene = withActor(bytes);
    scene.navigation = { kind: 'sphere', center: [0, 0, 0], radius: 4 };
    const { manifest } = await collect([scene], 'godot', { assetBytes: () => bytes });
    expect(manifest.runtime).toBeUndefined();
    expect(manifest.compatibility).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GAMEPLAY_UNMAPPED' }),
        expect.objectContaining({ code: 'SPHERICAL_NAVIGATION_UNMAPPED' }),
      ]),
    );
  });
});
