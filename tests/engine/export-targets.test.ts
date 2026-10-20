import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setImmediate as eventLoopTurn } from 'node:timers/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { emptyScene, node, type CampaignSpec } from '@virtualworld/scene-schema';
import { createExport } from '../../apps/web/server/export';
import { createApp } from '../../apps/web/server/app';
import { industrialDemo } from '../fixtures/scenes';
import { validTriangleGlb } from '../fixtures/glb';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-export-targets-'));
  roots.push(root);
  const options = {
    playerRoot: join(root, 'missing-player'),
    assetRoot: join(root, 'assets'),
    publicRoot: join(root, 'public'),
  };
  await mkdir(options.assetRoot);
  await mkdir(join(options.publicRoot, 'fixtures'), { recursive: true });
  return { root, options };
}
it.each(['godot', 'unity', 'unreal'] as const)(
  'exports %s without accessing a player build and preserves source and licenses',
  async (target) => {
    const { options } = await setup();
    const scene = industrialDemo();
    const original = structuredClone(scene);
    const files = unzipSync(await createExport(scene, { ...options, target }));
    expect(files).not.toHaveProperty('index.html');
    expect(files).toHaveProperty(
      target === 'godot'
        ? 'project.godot'
        : target === 'unity'
          ? 'Editor/VirtualWorldImporter.cs'
          : 'VirtualWorld.uproject',
    );
    expect(files).toHaveProperty('LICENSES.txt');
    expect(files).toHaveProperty('THIRD_PARTY_NOTICES.md');
    expect(JSON.parse(strFromU8(files['scene.json'])).id).toBe(scene.id);
    const manifest = JSON.parse(strFromU8(files['engine-manifest.json']));
    expect(manifest.target).toBe(target);
    expect(manifest.entrySceneId).toBe(scene.id);
    expect(manifest.assets.length).toBeGreaterThan(0);
    expect(scene).toEqual(original);
  },
);
it('budgets derived GLBs, raw copies, scripts and metadata at the exact native archive size', async () => {
  const { options } = await setup();
  const scene = industrialDemo();
  const files = unzipSync(await createExport(scene, { ...options, target: 'godot' }));
  const total = Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0);
  expect(Object.keys(files).some((name) => name.startsWith('raw/'))).toBe(true);
  await expect(
    createExport(scene, { ...options, target: 'godot', maxBytes: total - 1 }),
  ).rejects.toMatchObject({ statusCode: 413 });
  expect(
    Object.keys(
      unzipSync(await createExport(scene, { ...options, target: 'godot', maxBytes: total })),
    ),
  ).toEqual(Object.keys(files));
  await expect(
    createExport(scene, { ...options, target: 'godot', maxBytes: 512 }),
  ).rejects.toMatchObject({ statusCode: 413 });
});
it('rejects native asset symlink escapes through the shared reader', async () => {
  const { root, options } = await setup();
  const bytes = await validTriangleGlb();
  await writeFile(join(root, 'outside.glb'), bytes);
  await symlink(join(root, 'outside.glb'), join(options.publicRoot, 'fixtures/model.glb'));
  const scene = emptyScene();
  scene.assets.push({
    id: 'source',
    name: 'source',
    type: 'glb',
    url: '/fixtures/model.glb',
    bytes: bytes.length,
  });
  await expect(createExport(scene, { ...options, target: 'unity' })).rejects.toMatchObject({
    statusCode: 400,
  });
});
it('cancels a native export during shared asynchronous ZIP compression', async () => {
  const { options } = await setup();
  const scene = emptyScene();
  const bytes = randomBytes(4 * 1024 * 1024);
  await writeFile(join(options.publicRoot, 'fixtures/large.ply'), bytes);
  scene.assets.push({
    id: 'splat',
    name: 'retained source',
    type: 'splat',
    url: '/fixtures/large.ply',
    bytes: bytes.length,
  });
  const controller = new AbortController();
  const workers = () =>
    process.getActiveResourcesInfo().filter((name) => name === 'MessagePort').length;
  const baseline = workers();
  let completed = false;
  const pending = createExport(scene, {
    ...options,
    target: 'godot',
    signal: controller.signal,
  }).finally(() => {
    completed = true;
  });
  const outcome = pending.then(
    () => null,
    (error: unknown) => error,
  );
  const deadline = Date.now() + 5000;
  while (!completed && workers() <= baseline && Date.now() < deadline) await eventLoopTurn();
  const started = workers() > baseline;
  controller.abort();
  expect(await outcome).toMatchObject({ name: 'AbortError' });
  expect(started).toBe(true);
});
it('validates the HTTP target enum before export and supports native requests without player files', async () => {
  const { root, options } = await setup();
  const app = await createApp({
    ...options,
    dataRoot: join(root, 'data'),
    projectRoot: root,
    llm: { baseUrl: '', key: '', model: '' },
  });
  const request = (target?: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/export',
      headers: { host: '127.0.0.1:3001' },
      payload: { scene: emptyScene(), ...(target === undefined ? {} : { target }) },
    });
  try {
    for (const target of ['unknown-engine', '', null, 42])
      expect((await request(target)).statusCode).toBe(400);
    for (const target of ['godot', 'unity', 'unreal']) {
      const response = await request(target);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
      expect(
        JSON.parse(strFromU8(unzipSync(response.rawPayload)['engine-manifest.json'])).target,
      ).toBe(target);
    }
    expect((await request()).statusCode).toBe(503);
  } finally {
    await app.close();
  }
});

it('retains byte-identical shared campaign GLBs and selects the current chapter as native entry', async () => {
  const { options } = await setup();
  const source = await validTriangleGlb();
  await writeFile(join(options.publicRoot, 'fixtures/model.glb'), source);
  const manifest: CampaignSpec = {
    version: 1,
    id: 'little-prince',
    title: 'Campaign fixture',
    description: '',
    chapters: [0, 1].map((i) => ({
      id: `chapter-${i}`,
      title: `Chapter ${i}`,
      directory: `chapter-${i}`,
    })),
  };
  const scenes = manifest.chapters.map((chapter, index) => {
    const scene = emptyScene();
    scene.id = chapter.id;
    scene.campaign = { id: manifest.id, chapterId: chapter.id, index };
    scene.assets.push({
      id: 'model',
      name: 'source',
      type: 'glb',
      url: '/fixtures/model.glb',
      bytes: source.length,
    });
    scene.nodes.push(
      node('model-node', 'Model', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', { assetId: 'model' }),
    );
    return scene;
  });
  const files = unzipSync(
    await createExport(scenes[1], { ...options, target: 'godot', campaign: { manifest, scenes } }),
  );
  const sourcePaths = Object.keys(files).filter((path) => path.startsWith('assets/scene-'));
  expect(sourcePaths).toHaveLength(1);
  expect(Buffer.from(files[sourcePaths[0]])).toEqual(source);
  const native = JSON.parse(strFromU8(files['engine-manifest.json']));
  expect(native.entrySceneId).toBe(scenes[1].id);
  expect(native.scenes.map((scene: { id: string }) => scene.id)).toEqual(
    scenes.map((scene) => scene.id),
  );
  expect(native.assets).toHaveLength(1);
  expect(Buffer.from(files[native.assets[0].path])).toEqual(source);
  expect(native.assets[0].sources).toHaveLength(2);
  for (const scene of scenes) expect(files).toHaveProperty(`chapters/${scene.id}/scene.json`);
  expect(files).toHaveProperty('campaign.json');
  expect(strFromU8(files['ATTRIBUTION.txt'])).toContain('Little Prince three-chapter adaptation');
});
it('propagates native derived-content budget overflow as HTTP 413', async () => {
  const { root, options } = await setup();
  const app = await createApp({
    ...options,
    dataRoot: join(root, 'data'),
    projectRoot: root,
    limits: { maxExportBytes: 1024 },
    llm: { baseUrl: '', key: '', model: '' },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      headers: { host: '127.0.0.1:3001' },
      payload: { scene: industrialDemo(), target: 'godot' },
    });
    expect(response.statusCode).toBe(413);
  } finally {
    await app.close();
  }
});
it('honors native cancellation before touching unavailable roots', async () => {
  const { options } = await setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    createExport(emptyScene(), { ...options, target: 'unity', signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
