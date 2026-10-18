import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { splitWorld } from '@virtualworld/scene-builder';
import { industrialDemo } from '../fixtures/scenes';
import { listWorlds, listCampaigns } from '@virtualworld/scene-builder/io';
import { assertScene, type CampaignSpec, type SceneSpec } from '@virtualworld/scene-schema';
import { createApp } from '../../apps/web/server/app';
import { ProjectStore } from '../../apps/web/server/store';
import { createExport } from '../../apps/web/server/export';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function writeBundle(directory: string, scene: SceneSpec) {
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(splitWorld(scene)))
    await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-campaign-api-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const worldsRoot = join(root, 'worlds'),
    campaignRoot = join(worldsRoot, 'sample');
  const manifest: CampaignSpec = {
    version: 1,
    id: 'test-campaign',
    title: 'Fixture campaign',
    description: 'Local deterministic fixture',
    chapters: [
      { id: 'chapter-one', title: 'One', directory: 'chapters/one' },
      { id: 'chapter-two', title: 'Two', directory: 'chapters/two', requires: ['chapter-one'] },
      {
        id: 'chapter-three',
        title: 'Three',
        directory: 'chapters/three',
        requires: ['chapter-two'],
      },
    ],
  };
  const assetBytes = Buffer.from('local fixture shared bytes; no external model request');
  const scenes = manifest.chapters.map((chapter, index) =>
    assertScene({
      ...industrialDemo(),
      id: chapter.id,
      name: chapter.title,
      revision: 0,
      nodes: [
        {
          id: 'fixture-node',
          name: 'Fixture asset',
          kind: 'mesh',
          shape: 'glb',
          assetId: 'shared-mesh',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          size: [1, 1, 1],
          color: '#aaaaaa',
          visible: true,
        },
      ],
      tasks: [],
      assets: [
        {
          id: 'shared-mesh',
          name: 'Fixture shared mesh',
          type: 'glb',
          url: `/fixtures/mesh-${index}.glb`,
          bytes: assetBytes.length,
          source: 'retained/source-fixture.glb',
        },
      ],
      campaign: { id: manifest.id, chapterId: chapter.id, index },
    }),
  );
  await mkdir(campaignRoot, { recursive: true });
  await writeFile(join(campaignRoot, 'campaign.json'), JSON.stringify(manifest));
  for (let i = 0; i < scenes.length; i++)
    await writeBundle(join(campaignRoot, manifest.chapters[i].directory), scenes[i]);
  const publicRoot = join(root, 'public');
  await mkdir(join(publicRoot, 'fixtures'), { recursive: true });
  for (let i = 0; i < scenes.length; i++)
    await writeFile(join(publicRoot, 'fixtures', `mesh-${i}.glb`), assetBytes);
  const playerRoot = join(root, 'player');
  await mkdir(join(playerRoot, 'assets'), { recursive: true });
  await writeFile(
    join(playerRoot, 'player.html'),
    '<script type="module" src="./assets/player.js"></script>',
  );
  await writeFile(join(playerRoot, 'assets/player.js'), '/* deterministic test player fixture */');
  const dataRoot = join(root, 'data'),
    store = new ProjectStore(dataRoot, worldsRoot);
  const exportOptions = { playerRoot, publicRoot, assetRoot: join(dataRoot, 'assets') };
  return {
    root,
    worldsRoot,
    campaignRoot,
    manifest,
    scenes,
    publicRoot,
    playerRoot,
    dataRoot,
    store,
    assetBytes,
    exportOptions,
  };
}

it('discovers nested campaign bundles alongside standalone worlds in manifest order', async () => {
  const f = await setup(),
    standalone = industrialDemo();
  standalone.id = 'standalone-fixture';
  await writeBundle(join(f.worldsRoot, 'standalone'), standalone);
  const worlds = await listWorlds(f.worldsRoot);
  expect(worlds.map((w) => w.scene.id)).toEqual([
    'chapter-one',
    'chapter-two',
    'chapter-three',
    'standalone-fixture',
  ]);
  expect(worlds.slice(0, 3).map((w) => w.directory)).toEqual([
    'sample/chapters/one',
    'sample/chapters/two',
    'sample/chapters/three',
  ]);
  expect(await listCampaigns(f.worldsRoot)).toEqual([f.manifest]);
});
it('prefers saved chapter revisions to source bundles without mutating sibling chapters', async () => {
  const f = await setup(),
    edited = { ...f.scenes[1], name: 'Saved chapter edit', revision: 4 };
  await f.store.save(edited.id, edited, 0);
  expect((await f.store.get(edited.id)).name).toBe('Saved chapter edit');
  const campaign = await f.store.campaign(f.manifest.id);
  expect(campaign.scenes.map((s) => s.revision)).toEqual([0, 4, 0]);
  expect((await listWorlds(f.worldsRoot))[1].scene.revision).toBe(0);
});
it('rejects campaign membership/index mismatches while discovering nested bundles', async () => {
  const f = await setup();
  const wrong = { ...f.scenes[1], campaign: { ...f.scenes[1].campaign!, index: 0 } };
  await writeBundle(join(f.campaignRoot, f.manifest.chapters[1].directory), wrong);
  await expect(listWorlds(f.worldsRoot)).rejects.toThrow(/metadata mismatch/);
});
it('rejects saved overrides that change a source chapter campaign membership', async () => {
  const f = await setup(),
    wrong = {
      ...f.scenes[1],
      revision: 1,
      campaign: { ...f.scenes[1].campaign!, id: 'foreign-campaign' },
    };
  await expect(f.store.save(wrong.id, wrong, 0)).rejects.toThrow();
});
it('rejects inconsistent persisted chapter metadata when loading a campaign', async () => {
  const f = await setup(),
    wrong = { ...f.scenes[1], revision: 1, campaign: { ...f.scenes[1].campaign!, index: 0 } };
  await mkdir(join(f.dataRoot, 'projects'), { recursive: true });
  await writeFile(join(f.dataRoot, 'projects', `${wrong.id}.json`), JSON.stringify(wrong));
  await expect(f.store.campaign(f.manifest.id)).rejects.toThrow();
});
it('exposes campaign manifests and saved chapter edits through real Fastify routes', async () => {
  const f = await setup(),
    app = await createApp({
      projectRoot: f.root,
      dataRoot: f.dataRoot,
      publicRoot: f.publicRoot,
      playerRoot: f.playerRoot,
    });
  cleanups.push(() => app.close());
  const listing = await app.inject('/api/campaigns');
  expect(listing.statusCode).toBe(200);
  expect(listing.json().campaigns).toEqual([f.manifest]);
  const edited = { ...f.scenes[1], name: 'API saved edit', revision: 1 };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/projects/${edited.id}`,
        payload: { scene: edited, baseRevision: 0 },
      })
    ).statusCode,
  ).toBe(200);
  const response = await app.inject(`/api/campaigns/${f.manifest.id}`);
  expect(response.statusCode).toBe(200);
  expect(response.json().scenes[1].name).toBe('API saved edit');
  expect((await app.inject('/api/campaigns/unknown')).statusCode).toBe(404);
});
it('exports every chapter, preserves the current unsaved revision and deduplicates identical asset bytes', async () => {
  const f = await setup();
  await f.store.save(f.scenes[1].id, { ...f.scenes[1], name: 'Disk edit', revision: 3 }, 0);
  const current = { ...f.scenes[1], name: 'Current unsaved edit', revision: 7 };
  const app = await createApp({
    projectRoot: f.root,
    dataRoot: f.dataRoot,
    publicRoot: f.publicRoot,
    playerRoot: f.playerRoot,
  });
  cleanups.push(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/export',
    payload: { scene: current },
  });
  expect(response.statusCode).toBe(200);
  const files = unzipSync(response.rawPayload),
    decode = (name: string) => JSON.parse(strFromU8(files[name]));
  const manifest = decode('campaign.json');
  expect(manifest.chapters.map((c: { directory: string }) => c.directory)).toEqual(
    f.manifest.chapters.map((c) => `chapters/${c.id}`),
  );
  const chapters = f.manifest.chapters.map((c) => decode(`chapters/${c.id}/scene.json`));
  expect(chapters.map((s) => s.id)).toEqual(f.scenes.map((s) => s.id));
  expect(chapters[1]).toMatchObject({ name: 'Current unsaved edit', revision: 7 });
  expect(chapters.map((s) => s.assets[0].url)).toEqual(Array(3).fill(chapters[0].assets[0].url));
  expect(Object.keys(files).filter((name) => name.startsWith('assets/scene-'))).toHaveLength(1);
  expect(Buffer.from(files[chapters[0].assets[0].url])).toEqual(f.assetBytes);
  expect(
    chapters.every((s) => s.assets[0].bytes === f.assetBytes.length && !s.assets[0].source),
  ).toBe(true);
  expect(files['index.html']).toBeDefined();
  expect(files['assets/player.js']).toBeDefined();
  expect(decode('scene.json').id).toBe('chapter-one');
  expect((await f.store.get(current.id)).revision).toBe(3);
});
it('rejects incomplete campaign exports and missing chapter bundles', async () => {
  const f = await setup();
  await expect(
    createExport(f.scenes[0], {
      ...f.exportOptions,
      campaign: { manifest: f.manifest, scenes: f.scenes.slice(0, 2) },
    }),
  ).rejects.toThrow(/缺失/);
  await rm(join(f.campaignRoot, f.manifest.chapters[2].directory), { recursive: true });
  await expect(f.store.campaign(f.manifest.id)).rejects.toThrow();
});
it('rejects stripping campaign membership from a known chapter at the export API', async () => {
  const f = await setup();
  const app = await createApp({
    projectRoot: f.root,
    dataRoot: f.dataRoot,
    publicRoot: f.publicRoot,
    playerRoot: f.playerRoot,
  });
  cleanups.push(() => app.close());
  const scene = { ...f.scenes[0] };
  delete scene.campaign;
  const response = await app.inject({ method: 'POST', url: '/api/export', payload: { scene } });
  expect(response.statusCode).toBe(400);
});
it('rejects inconsistent campaign metadata on any chapter supplied for export', async () => {
  const f = await setup(),
    wrong = { ...f.scenes[2], campaign: { ...f.scenes[2].campaign!, id: 'foreign-campaign' } };
  await expect(
    createExport(f.scenes[0], {
      ...f.exportOptions,
      campaign: { manifest: f.manifest, scenes: [f.scenes[0], f.scenes[1], wrong] },
    }).then(() => null),
  ).rejects.toThrow();
});
it('rejects manifest directory traversal and asset traversal before export', async () => {
  const f = await setup(),
    badManifest = {
      ...f.manifest,
      chapters: [{ ...f.manifest.chapters[0], directory: '../outside' }],
    };
  await writeFile(join(f.campaignRoot, 'campaign.json'), JSON.stringify(badManifest));
  await expect(listWorlds(f.worldsRoot)).rejects.toThrow();
  await expect(
    createExport(f.scenes[0], {
      ...f.exportOptions,
      campaign: { manifest: badManifest, scenes: f.scenes },
    }),
  ).rejects.toThrow();
  const badAsset = {
    ...f.scenes[0],
    assets: [{ ...f.scenes[0].assets[0], url: '/fixtures/../secret.glb' }],
  };
  await expect(
    createExport(badAsset, {
      ...f.exportOptions,
      campaign: { manifest: f.manifest, scenes: f.scenes },
    }),
  ).rejects.toThrow();
});
