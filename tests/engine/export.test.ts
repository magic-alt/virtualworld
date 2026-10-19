import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setImmediate as eventLoopTurn } from 'node:timers/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { createExport } from '../../apps/web/server/export';
import { industrialDemo } from '../fixtures/scenes';
import { glbWithJson, validTriangleGlb } from '../fixtures/glb';
import type { CampaignSpec, SceneSpec } from '@virtualworld/scene-schema';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-export-'));
  roots.push(root);
  const options = {
    playerRoot: join(root, 'player'),
    assetRoot: join(root, 'legacy'),
    publicRoot: join(root, 'public'),
    assetLibraryRoot: join(root, 'library'),
    runtimeAssetRoot: join(root, 'runtime'),
  };
  for (const path of Object.values(options)) await mkdir(path, { recursive: true });
  await mkdir(join(options.publicRoot, 'fixtures'));
  await mkdir(join(options.runtimeAssetRoot, 'optimized'));
  await writeFile(join(options.playerRoot, 'player.html'), '<p>Offline export</p>');
  return { root, options, scene: industrialDemo() };
}
function addAsset(scene: SceneSpec, url: string, bytes: number, type: 'glb' | 'splat' = 'glb') {
  scene.assets.push({ id: 'export-asset', name: 'Export fixture', type, url, bytes });
}

it('rejects oversized inputs with 413 before GLB validation and counts player files', async () => {
  const f = await setup();
  await writeFile(join(f.options.playerRoot, 'large.js'), Buffer.alloc(128 * 1024));
  await expect(
    createExport(f.scene, { ...f.options, maxBytes: 1024 }).then(() => 'completed'),
  ).rejects.toMatchObject({ statusCode: 413 });
  await rm(join(f.options.playerRoot, 'large.js'));
  await writeFile(join(f.options.publicRoot, 'fixtures/large.glb'), Buffer.alloc(128 * 1024));
  addAsset(f.scene, '/fixtures/large.glb', 1);
  await expect(
    createExport(f.scene, { ...f.options, maxBytes: 1024 }).then(() => 'completed'),
  ).rejects.toMatchObject({ statusCode: 413 });
});
it('counts all serialized metadata and notices in the exact uncompressed byte budget', async () => {
  const f = await setup();
  const files = unzipSync(await createExport(f.scene, f.options));
  const bytes = Object.values(files).reduce((sum, file) => sum + file.length, 0);
  await expect(
    createExport(f.scene, { ...f.options, maxBytes: bytes - 1 }).then(() => 'completed'),
  ).rejects.toMatchObject({ statusCode: 413 });
  expect(unzipSync(await createExport(f.scene, { ...f.options, maxBytes: bytes }))).toHaveProperty(
    'LICENSES.txt',
  );
});
it('honors cancellation before touching unavailable player or asset roots', async () => {
  const f = await setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    createExport(f.scene, {
      ...f.options,
      playerRoot: '/missing-player',
      signal: controller.signal,
    }).then(() => 'completed'),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('allows event-loop work and cancellation while asynchronous compression is active', async () => {
  const f = await setup();
  await writeFile(join(f.options.playerRoot, 'large.js'), randomBytes(4 * 1024 * 1024));
  const workers = () =>
    process.getActiveResourcesInfo().filter((name) => name === 'MessagePort').length;
  const baseline = workers();
  const controller = new AbortController();
  let completed = false;
  const pending = createExport(f.scene, { ...f.options, signal: controller.signal }).then(
    () => {
      completed = true;
      return 'completed';
    },
    (error) => {
      completed = true;
      throw error;
    },
  );
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  let turns = 0;
  const deadline = Date.now() + 5000;
  while (!completed && workers() <= baseline && Date.now() < deadline) {
    await eventLoopTurn();
    turns++;
  }
  // Observe a real compression worker rather than cancelling during file reads.
  const compressionStarted = workers() > baseline;
  controller.abort();
  await cancelled;
  expect(compressionStarted).toBe(true);
  expect(turns).toBeGreaterThan(0);
});

it.each([
  ['invalid container', Buffer.from('glTF-not-a-container')],
  [
    'Khronos structural error',
    glbWithJson({ asset: { version: '2.0' }, buffers: [{ byteLength: -1 }] }),
  ],
  [
    'external resource',
    glbWithJson({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4, uri: 'https://example.com/a.bin' }],
    }),
  ],
  [
    'unsupported compression',
    glbWithJson({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }),
  ],
])('revalidates legacy GLB content at export: %s', async (_label, bytes) => {
  const f = await setup();
  await writeFile(join(f.options.publicRoot, 'fixtures/model.glb'), bytes);
  addAsset(f.scene, '/fixtures/model.glb', bytes.length);
  await expect(createExport(f.scene, f.options).then(() => 'completed')).rejects.toMatchObject({
    statusCode: 400,
  });
});
it('rejects raw STEP files referenced as playable GLB assets', async () => {
  const f = await setup();
  const filename = `${'a'.repeat(64)}.step`;
  await writeFile(join(f.options.assetRoot, filename), 'ISO-10303-21;');
  addAsset(f.scene, `/api/assets/${filename}`, 12);
  await expect(createExport(f.scene, f.options).then(() => 'completed')).rejects.toMatchObject({
    statusCode: 400,
  });
});
it('uses additional durable runtime roots only when preceding roots are absent', async () => {
  const f = await setup();
  const generated = join(f.root, 'generated');
  await mkdir(join(generated, 'optimized'), { recursive: true });
  const bytes = await validTriangleGlb();
  await writeFile(join(generated, 'optimized/model.glb'), bytes);
  addAsset(f.scene, '/assets/optimized/model.glb', bytes.length);
  const options = { ...f.options, additionalRuntimeAssetRoots: [generated] };
  const files = unzipSync(await createExport(f.scene, options));
  expect(Buffer.from(files['assets/scene-export-asset.glb'])).toEqual(bytes);
  await writeFile(join(f.options.runtimeAssetRoot, 'optimized/model.glb'), 'corrupt primary');
  await expect(createExport(f.scene, options).then(() => 'completed')).rejects.toMatchObject({
    statusCode: 400,
  });
});
it.each(['player', 'runtime', 'upload'])(
  'rejects %s symlink escapes instead of exporting outside bytes',
  async (kind) => {
    const f = await setup();
    const bytes = await validTriangleGlb();
    const outside = join(f.root, 'outside.glb');
    await writeFile(outside, bytes);
    if (kind === 'player') await symlink(outside, join(f.options.playerRoot, 'outside.js'));
    else if (kind === 'runtime') {
      await symlink(outside, join(f.options.runtimeAssetRoot, 'optimized/model.glb'));
      addAsset(f.scene, '/assets/optimized/model.glb', bytes.length);
    } else {
      const filename = `${createHash('sha256').update(bytes).digest('hex')}.glb`;
      await mkdir(join(f.options.assetLibraryRoot, 'optimized/uploads'), { recursive: true });
      await symlink(outside, join(f.options.assetLibraryRoot, 'optimized/uploads', filename));
      // A valid legacy fallback must not mask an unsafe primary path.
      await writeFile(join(f.options.assetRoot, filename), bytes);
      addAsset(f.scene, `/api/assets/${filename}`, bytes.length);
    }
    await expect(createExport(f.scene, f.options).then(() => 'completed')).rejects.toMatchObject({
      statusCode: 400,
    });
  },
);
it('preserves verified upload hashes instead of silently exporting changed runtime bytes', async () => {
  const f = await setup();
  const bytes = await validTriangleGlb();
  const filename = `${'0'.repeat(64)}.glb`;
  await writeFile(join(f.options.assetRoot, filename), bytes);
  addAsset(f.scene, `/api/assets/${filename}`, bytes.length);
  await expect(createExport(f.scene, f.options).then(() => 'completed')).rejects.toMatchObject({
    statusCode: 400,
  });
});
it('deduplicates shared campaign sources and preserves offline chapter metadata', async () => {
  const f = await setup();
  const bytes = Buffer.alloc(100 * 1024, 7);
  await writeFile(join(f.options.publicRoot, 'fixtures/shared.ply'), bytes);
  const manifest: CampaignSpec = {
    version: 1,
    id: 'export-campaign',
    title: 'Export',
    description: '',
    chapters: [0, 1, 2].map((i) => ({
      id: `chapter-${i}`,
      title: `Chapter ${i}`,
      directory: `original/${i}`,
    })),
  };
  const scenes = manifest.chapters.map((chapter, index) => {
    const scene = structuredClone(f.scene);
    scene.id = chapter.id;
    scene.campaign = { id: manifest.id, chapterId: chapter.id, index };
    addAsset(scene, '/fixtures/shared.ply', bytes.length, 'splat');
    return scene;
  });
  const options = { ...f.options, campaign: { manifest, scenes }, maxBytes: 200 * 1024 };
  const files = unzipSync(await createExport(scenes[1], options));
  const assets = Object.keys(files).filter((name) => name.startsWith('assets/scene-'));
  expect(assets).toHaveLength(1);
  expect(Buffer.from(files[assets[0]])).toEqual(bytes);
  for (const chapter of manifest.chapters) {
    const scene = JSON.parse(strFromU8(files[`chapters/${chapter.id}/scene.json`]));
    expect(scene.assets[0].url).toBe(assets[0]);
  }
});

it('admits distinct campaign paths with identical bytes at the exact deduplicated archive budget', async () => {
  const f = await setup();
  const bytes = Buffer.alloc(100 * 1024, 7);
  for (const filename of ['same-a.ply', 'same-b.ply'])
    await writeFile(join(f.options.publicRoot, 'fixtures', filename), bytes);
  const manifest: CampaignSpec = {
    version: 1,
    id: 'duplicate-content',
    title: 'Duplicate content',
    description: '',
    chapters: [0, 1].map((index) => ({
      id: `chapter-${index}`,
      title: 'Chapter',
      directory: `chapter-${index}`,
    })),
  };
  const scenes = manifest.chapters.map((chapter, index) => {
    const scene = structuredClone(f.scene);
    scene.id = chapter.id;
    scene.campaign = { id: manifest.id, chapterId: chapter.id, index };
    scene.assets = [
      {
        id: `asset-${index}`,
        name: 'Same content',
        type: 'splat',
        url: `/fixtures/same-${index ? 'b' : 'a'}.ply`,
        bytes: bytes.length,
      },
    ];
    return scene;
  });
  const options = { ...f.options, campaign: { manifest, scenes } };
  const files = unzipSync(await createExport(scenes[0], options));
  const actualBytes = Object.values(files).reduce((sum, file) => sum + file.length, 0);
  expect(Object.keys(files).filter((name) => name.startsWith('assets/scene-'))).toHaveLength(1);
  const exact = unzipSync(await createExport(scenes[0], { ...options, maxBytes: actualBytes }));
  expect(Object.keys(exact)).toEqual(Object.keys(files));
  await expect(
    createExport(scenes[0], { ...options, maxBytes: actualBytes - 1 }).then(() => 'completed'),
  ).rejects.toMatchObject({ statusCode: 413 });
  // Equal sizes alone must not admit a different asset beyond the remaining budget.
  await writeFile(join(f.options.publicRoot, 'fixtures/same-b.ply'), Buffer.alloc(bytes.length, 8));
  await expect(
    createExport(scenes[0], { ...options, maxBytes: actualBytes }).then(() => 'completed'),
  ).rejects.toMatchObject({ statusCode: 413 });
});
