import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/web/server/app';
import { industrialDemo } from '../fixtures/scenes';
import { emptyScene } from '@virtualworld/scene-schema';
import { writeWorld } from '@virtualworld/scene-builder/io';

const secret = 'test-gateway-secret-at-least-32-characters';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(hosted = true) {
  const root = await mkdtemp(join(tmpdir(), 'vw-access-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const studioRoot = join(root, 'studio');
  await mkdir(studioRoot);
  await writeFile(join(studioRoot, 'index.html'), '<h1>Private studio</h1>');
  const app = await createApp({
    dataRoot: join(root, 'data'),
    projectRoot: root,
    publicRoot: join(root, 'public'),
    studioRoot,
    accessPolicy: hosted
      ? { mode: 'hosted', publicOrigin: 'https://studio.example', gatewaySecret: secret }
      : { mode: 'local', port: 3001 },
  });
  cleanup.push(() => app.close());
  return { app, root };
}
const gateway = { host: 'studio.example', 'x-virtualworld-gateway': secret };

it('requires gateway authentication for the studio, API and asset routes even without Origin', async () => {
  const { app } = await setup();
  for (const url of [
    '/',
    '/api/projects',
    '/api/health',
    '/api/generation/capabilities',
    '/assets/optimized/private.glb',
    '/api/assets/file.glb',
  ]) {
    const result = await app.inject({ url, headers: { host: 'studio.example' } });
    expect(result.statusCode, url).toBe(403);
    expect(result.body).not.toContain('Private studio');
  }
  const wrong = await app.inject({
    url: '/api/projects',
    headers: { ...gateway, 'x-virtualworld-gateway': 'incorrect' },
  });
  expect(wrong.statusCode).toBe(403);
  expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
});

it('accepts exact authenticated same-origin requests and keeps API data out of shared caches', async () => {
  const { app } = await setup();
  const write = await app.inject({
    method: 'PUT',
    url: '/api/projects/test-industrial',
    headers: { ...gateway, origin: 'https://studio.example' },
    payload: { scene: industrialDemo(), baseRevision: 0 },
  });
  expect(write.statusCode).toBe(200);
  const result = await app.inject({ url: '/api/projects/test-industrial', headers: gateway });
  expect(result.json().id).toBe('test-industrial');
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.headers['x-request-id']).toBeTruthy();
  expect((await app.inject({ url: '/', headers: gateway })).headers['cache-control']).toContain(
    'private',
  );
});

it('rejects cross-origin or wrong-host requests even when they carry the gateway secret', async () => {
  const { app } = await setup();
  for (const headers of [
    { ...gateway, origin: 'https://evil.example' },
    { ...gateway, origin: 'https://studio.example.evil.test' },
    { ...gateway, origin: 'https://studio.example/path' },
    { ...gateway, origin: 'null' },
    { ...gateway, host: 'evil.example', 'x-forwarded-host': 'studio.example' },
  ]) {
    expect((await app.inject({ url: '/api/projects', headers })).statusCode).toBe(403);
  }
});

it('rejects a non-loopback Host in local mode to prevent DNS rebinding access', async () => {
  const { app } = await setup(false);
  expect(
    (await app.inject({ url: '/api/projects', headers: { host: 'attacker.example' } })).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: '/api/projects',
        headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
      })
    ).statusCode,
  ).toBe(200);
});

it('returns safe server errors without exposing on-disk paths or malformed project contents', async () => {
  const { app, root } = await setup();
  await mkdir(join(root, 'data/projects'), { recursive: true });
  await writeFile(join(root, 'data/projects/broken.json'), 'sensitive-project-data invalid JSON');
  const result = await app.inject({ url: '/api/projects/broken', headers: gateway });
  expect(result.statusCode).toBe(500);
  expect(result.json()).toEqual({ error: '服务器暂时无法完成请求', requestId: expect.any(String) });
  expect(result.body).not.toContain('sensitive-project-data');
  expect(result.body).not.toContain(root);
});

it.each(['/api/projects', '/api/projects/corrupt-world'])(
  'sanitizes retained world schema errors at %s instead of disclosing invalid field values',
  async (url) => {
    const { app, root } = await setup();
    const scene = { ...emptyScene('world'), id: 'corrupt-world' };
    const directory = await writeWorld(join(root, 'worlds'), scene);
    const path = join(directory, 'scene.json');
    const retained = JSON.parse(await readFile(path, 'utf8'));
    const privateValue = 'synthetic-private-retained-world-content';
    await writeFile(path, JSON.stringify({ ...retained, mode: privateValue }));
    const result = await app.inject({ url, headers: gateway });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({
      error: '服务器暂时无法完成请求',
      requestId: expect.any(String),
    });
    expect(result.json().requestId).toBe(result.headers['x-request-id']);
    expect(result.body).not.toContain(privateValue);
    expect(result.body).not.toContain(root);
  },
);

it.each(['/api/campaigns', '/api/campaigns/corrupt-campaign', '/api/projects'])(
  'sanitizes retained campaign schema errors at %s instead of disclosing private field names',
  async (url) => {
    const { app, root } = await setup();
    const directory = join(root, 'worlds/corrupt-campaign');
    await mkdir(directory, { recursive: true });
    const privateField = 'synthetic-private-retained-campaign-field';
    await writeFile(
      join(directory, 'campaign.json'),
      JSON.stringify({
        version: 1,
        id: 'corrupt-campaign',
        title: 'Campaign',
        description: '',
        chapters: [{ id: 'chapter-one', title: 'One', directory: 'chapter-one' }],
        [privateField]: 'private retained value',
      }),
    );
    const result = await app.inject({ url, headers: gateway });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({
      error: '服务器暂时无法完成请求',
      requestId: expect.any(String),
    });
    expect(result.json().requestId).toBe(result.headers['x-request-id']);
    expect(result.body).not.toContain(privateField);
    expect(result.body).not.toContain('private retained value');
    expect(result.body).not.toContain(root);
  },
);

it('keeps explicit request schema and generation identity failures as useful client errors', async () => {
  const { app } = await setup();
  const scene = industrialDemo();
  const invalidScene = { ...scene, mode: 'invalid-request-mode' };
  const generation = {
    requestId: 'valid-request-identity',
    description: 'Fixture',
    planner: 'builtin',
    assets: 'builtin',
  };
  const cases = [
    {
      method: 'PUT',
      url: '/api/projects/test-industrial',
      payload: { scene: invalidScene, baseRevision: 0 },
      field: 'scene.mode',
    },
    {
      method: 'PUT',
      url: '/api/projects/test-industrial',
      payload: { scene, baseRevision: -1 },
      field: 'baseRevision',
    },
    { method: 'POST', url: '/api/validate', payload: { scene: invalidScene }, field: 'scene.mode' },
    { method: 'POST', url: '/api/export', payload: { scene: invalidScene }, field: 'scene.mode' },
    {
      method: 'POST',
      url: '/api/agent',
      payload: { scene: invalidScene, prompt: 'Rename' },
      field: 'scene.mode',
    },
    { method: 'POST', url: '/api/agent', payload: { scene }, field: 'prompt' },
    {
      method: 'POST',
      url: '/api/generations',
      payload: { ...generation, requestId: 'bad' },
      field: 'requestId',
    },
    {
      method: 'POST',
      url: '/api/generations',
      payload: { ...generation, description: '' },
      field: 'description',
    },
    { method: 'GET', url: '/api/generations/bad', field: 'Invalid' },
    { method: 'POST', url: '/api/generations/bad/resume', payload: {}, field: 'Invalid' },
    {
      method: 'POST',
      url: '/api/generations/valid-request-identity/resume',
      payload: { taskId: 'unsafe/path' },
      field: 'taskId',
    },
  ] as const;
  for (const input of cases) {
    const result = await app.inject({
      method: input.method,
      url: input.url,
      headers: gateway,
      ...('payload' in input ? { payload: input.payload } : {}),
    });
    expect(result.statusCode, input.url).toBe(400);
    expect(result.json().error, input.url).toContain(input.field);
    expect(result.body, input.url).not.toContain('服务器暂时无法完成请求');
  }
});

it('does not accept raw STEP source references as playable GLB assets', async () => {
  const { app } = await setup(false);
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/assets?name=part.step',
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from('ISO-10303-21; END-ISO-10303-21;'),
  });
  expect(uploaded.statusCode).toBe(200);
  expect(uploaded.json().type).toBe('source');
  const scene = industrialDemo();
  scene.assets = [{ ...uploaded.json(), type: 'glb' }];
  const result = await app.inject({ method: 'POST', url: '/api/validate', payload: { scene } });
  expect(result.statusCode).toBe(400);
});

it('returns client errors for semantic scene mistakes at every input boundary', async () => {
  const { app } = await setup(false);
  const scene = industrialDemo();
  scene.nodes[0].assetId = 'missing';
  for (const url of [
    '/api/validate',
    '/api/export',
    '/api/agent',
    '/api/projects/test-industrial',
  ]) {
    const result = await app.inject({
      method: url.startsWith('/api/projects/') ? 'PUT' : 'POST',
      url,
      payload:
        url === '/api/agent'
          ? { scene, prompt: 'Rename this project' }
          : url.startsWith('/api/projects/')
            ? { scene, baseRevision: 0 }
            : { scene },
    });
    expect(result.statusCode, url).toBe(400);
    expect(result.json().error, url).toContain('资源不存在');
  }
});

it('validates retained GLB content and rejects oversized files before loading them', async () => {
  const { app, root } = await setup(false);
  const fixtures = join(root, 'public/fixtures');
  await mkdir(fixtures, { recursive: true });
  const path = join(fixtures, 'legacy.glb');
  const invalid = Buffer.from('glTF invalid legacy bytes');
  await writeFile(path, invalid);
  const scene = industrialDemo();
  scene.assets = [
    {
      id: 'legacy',
      name: 'Legacy',
      type: 'glb',
      url: '/fixtures/legacy.glb',
      bytes: invalid.length,
    },
  ];
  const validate = () => app.inject({ method: 'POST', url: '/api/validate', payload: { scene } });
  expect((await validate()).statusCode).toBe(400);
  // Sparse input exercises the on-disk preflight without creating a giant fixture.
  await truncate(path, 101 * 1024 * 1024);
  scene.assets[0].bytes = 101 * 1024 * 1024;
  const oversized = await validate();
  expect(oversized.statusCode).toBe(400);
  expect(oversized.json().error).toContain('100 MiB');
});
