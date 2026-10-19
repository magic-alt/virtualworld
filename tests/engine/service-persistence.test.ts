import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { emptyScene, node, type SceneSpec } from '@virtualworld/scene-schema';
import { writeWorld } from '@virtualworld/scene-builder/io';
import { createApp } from '../../apps/web/server/app';
import { validTriangleGlb } from '../fixtures/glb';

const secret = 'persistence-fixture-gateway-secret-32-characters';
const headers = {
  host: 'studio.example.test',
  origin: 'https://studio.example.test',
  'x-virtualworld-gateway': secret,
};
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vw-service-persistence-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'code');
  const dataRoot = join(root, 'data');
  const playerRoot = join(root, 'player');
  const studioRoot = join(root, 'studio');
  const publicRoot = join(root, 'public');
  for (const directory of [projectRoot, playerRoot, studioRoot, publicRoot])
    await mkdir(directory, { recursive: true });
  await writeFile(join(playerRoot, 'player.html'), '<script src="./player.js"></script>');
  await writeFile(join(playerRoot, 'player.js'), '/* local standalone player fixture */');
  await writeFile(join(studioRoot, 'index.html'), '<h1>Private workspace fixture</h1>');
  const options = {
    dataRoot,
    projectRoot,
    playerRoot,
    studioRoot,
    publicRoot,
    llm: { baseUrl: '', key: '', model: '' },
    accessPolicy: {
      mode: 'hosted' as const,
      publicOrigin: 'https://studio.example.test',
      gatewaySecret: secret,
    },
  };
  const open = async () => {
    const app = await createApp(options);
    cleanup.push(() => app.close());
    return app;
  };
  return { root, projectRoot, dataRoot, options, open };
}

it('rejects a duplicate service before recovery can alter a live ledger and permits recovery after close', async () => {
  const f = await fixture();
  const app = await f.open();
  const input = {
    requestId: 'live-service-request',
    description: 'Retained active work; no provider is invoked by this fixture',
    planner: 'builtin',
    assets: 'builtin',
    allowPaid: false,
  };
  const path = join(f.dataRoot, 'generations', `${input.requestId}.json`);
  const retained = JSON.stringify({
    version: 1,
    id: input.requestId,
    worldId: `world-${input.requestId}`,
    input,
    phase: 'planning',
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
  });
  // Written after the owner starts: a competing init would incorrectly mark this interrupted.
  await writeFile(path, retained);
  await expect(createApp(f.options)).rejects.toThrow(/service lease is occupied/i);
  expect(await readFile(path, 'utf8')).toBe(retained);
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);

  await app.close();
  const reopened = await f.open();
  const recovered = await reopened.inject({ url: `/api/generations/${input.requestId}`, headers });
  expect(recovered.statusCode).toBe(200);
  expect(recovered.json()).toMatchObject({ id: input.requestId, phase: 'interrupted' });
  expect(JSON.parse(await readFile(path, 'utf8')).phase).toBe('interrupted');
  expect((await reopened.inject({ url: '/api/projects', headers })).json().projects).toEqual([]);
});

it('releases the acquired service lease when generation startup fails', async () => {
  const f = await fixture();
  const directory = join(f.dataRoot, 'generations');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'broken-startup-request.json');
  await writeFile(path, 'invalid retained generation JSON');
  await expect(createApp(f.options)).rejects.toBeInstanceOf(SyntaxError);
  await rm(path);
  // A leaked lease would block this actual second startup even after fixing the record.
  const app = await f.open();
  const service = await app.inject({ url: '/api/service', headers });
  expect(service.statusCode).toBe(200);
  expect(service.json()).toMatchObject({
    mode: 'hosted',
    workspace: 'shared',
    generation: { pending: 0, closed: false },
  });
});

it('serves, validates and exports newly published durable worlds alongside bundled content after restart', async () => {
  const f = await fixture();
  const bundled: SceneSpec = {
    ...emptyScene('world'),
    id: 'bundled-template',
    name: 'Bundled template',
  };
  await writeWorld(join(f.projectRoot, 'worlds'), bundled);
  let app = await f.open();
  const before = await app.inject({ url: '/api/projects', headers });
  expect(before.json().projects.map((project: { id: string }) => project.id)).toEqual([bundled.id]);

  const bytes = await validTriangleGlb();
  const url = '/assets/optimized/generated/durable-triangle.glb';
  const scene: SceneSpec = {
    ...emptyScene('world'),
    id: 'durable-generated-world',
    name: 'Durable generated world',
    assets: [{ id: 'durable-mesh', name: 'Triangle', type: 'glb', url, bytes: bytes.length }],
    nodes: [
      node('durable-node', 'Triangle', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
        assetId: 'durable-mesh',
        materialOverride: false,
      }),
    ],
  };
  // These files are published after startup, only in the default persistent workspace.
  const workspace = join(f.dataRoot, 'workspace');
  await mkdir(join(workspace, 'assets/optimized/generated'), { recursive: true });
  await writeFile(join(workspace, 'assets/optimized/generated/durable-triangle.glb'), bytes);
  await writeWorld(join(workspace, 'worlds'), scene);

  const assertDurableRoutes = async (expectedName: string) => {
    const list = await app.inject({ url: '/api/projects', headers });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json()
        .projects.map((project: { id: string }) => project.id)
        .sort(),
    ).toEqual([bundled.id, scene.id].sort());
    const loaded = await app.inject({ url: `/api/projects/${scene.id}`, headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().name).toBe(expectedName);
    const asset = await app.inject({ url, headers });
    expect(asset.statusCode).toBe(200);
    expect(asset.rawPayload).toEqual(bytes);
    const validation = await app.inject({
      method: 'POST',
      url: '/api/validate',
      headers,
      payload: { scene: loaded.json() },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({
      ok: true,
      assets: 1,
      validation: [{ assetId: 'durable-mesh', errors: 0 }],
    });
    const exported = await app.inject({
      method: 'POST',
      url: '/api/export',
      headers,
      payload: { scene: loaded.json() },
    });
    expect(exported.statusCode).toBe(200);
    const files = unzipSync(exported.rawPayload);
    const exportScene = JSON.parse(strFromU8(files['scene.json']));
    expect(exportScene).toMatchObject({ id: scene.id, name: expectedName });
    expect(exportScene.assets[0].url).toMatch(/^assets\//);
    expect(Buffer.from(files[exportScene.assets[0].url])).toEqual(bytes);
    expect(strFromU8(files['index.html'])).toContain('./player.js');
  };
  await assertDurableRoutes(scene.name);
  const savedName = 'Saved durable overlay';
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/projects/${scene.id}`,
    headers,
    payload: { scene: { ...scene, name: savedName, revision: 1 }, baseRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  await app.close();
  app = await f.open();
  await assertDurableRoutes(savedName);
});

it('delivers authenticated uploaded assets with HEAD and conditional ETag responses', async () => {
  const f = await fixture();
  const app = await f.open();
  const bytes = await validTriangleGlb();
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/assets?name=triangle.glb',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  expect(uploaded.statusCode).toBe(200);
  const asset = uploaded.json();
  const downloaded = await app.inject({ url: asset.url, headers });
  expect(downloaded.statusCode).toBe(200);
  expect(downloaded.rawPayload).toEqual(bytes);
  expect(downloaded.headers.etag).toBeTruthy();
  expect(downloaded.headers['cache-control']).toBe('private, no-store');
  const head = await app.inject({ method: 'HEAD', url: asset.url, headers });
  expect(head.statusCode).toBe(200);
  expect(head.rawPayload).toHaveLength(0);
  expect(head.headers['content-length']).toBe(String(bytes.length));
  expect(head.headers.etag).toBe(downloaded.headers.etag);
  const unchanged = await app.inject({
    url: asset.url,
    headers: { ...headers, 'if-none-match': downloaded.headers.etag! },
  });
  expect(unchanged.statusCode).toBe(304);
  expect(unchanged.rawPayload).toHaveLength(0);
  expect((await app.inject({ url: asset.url, headers: { host: headers.host } })).statusCode).toBe(
    403,
  );
});
