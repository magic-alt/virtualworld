import { expect, it, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { builtinPlan, planWorld } from '@virtualworld/planner/world';
import { generateWorld } from '../../generators/scene-builder/src/generate';
import { createApp } from '../../apps/web/server/app';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'vw-full-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
it('runs real local HTTP planner + Tripo + glTF processing and serves the resulting world/assets', async () => {
  const root = await temp(),
    id = 'ai-generated',
    description = 'A quiet clockwork garden';
  const d = new Document(),
    buffer = d.createBuffer();
  const pos = d
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  d.createScene().addChild(
    d
      .createNode()
      .setMesh(d.createMesh().addPrimitive(d.createPrimitive().setAttribute('POSITION', pos))),
  );
  const bytes = await new NodeIO().writeBinary(d);
  let base = '',
    modelCalls = 0,
    creates = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/model.glb') {
      res.end(bytes);
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      modelCalls++;
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(builtinPlan({ id, description })) } }],
        }),
      );
    } else if (req.url === '/v3/generation/text-to-model') {
      creates++;
      res.end(JSON.stringify({ code: 0, data: { task_id: 'task_pipeline' } }));
    } else
      res.end(
        JSON.stringify({
          code: 0,
          data: { status: 'success', output: { model_url: base + '/model.glb' } },
        }),
      );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  cleanup.push(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
  const options = {
    root,
    id,
    description,
    planner: 'llm' as const,
    assets: 'tripo' as const,
    llm: { baseUrl: base + '/v1', model: 'fixture-model', key: 'private-llm-key' },
    tripo: { key: 'private-tripo-key', baseUrl: base + '/v3', pollIntervalMs: 1 },
  };
  const result = await generateWorld(options);
  expect(result.scene.assets).toHaveLength(1);
  expect(creates).toBe(1);
  expect(modelCalls).toBe(1);
  const asset = result.scene.assets[0];
  expect(result.scene.nodes.find((n) => n.id === 'star')).toMatchObject({
    shape: 'glb',
    assetId: asset.id,
  });
  const manifestRoot = join(root, 'assets/manifests/generated');
  const manifest = JSON.parse(
    await readFile(join(manifestRoot, (await readdir(manifestRoot))[0]), 'utf8'),
  );
  expect(manifest.processing.validation.errors).toBe(0);
  expect(manifest.taskId).toBe('task_pipeline');
  expect(JSON.stringify(manifest)).not.toContain('private-');
  const app = await createApp({
    dataRoot: join(root, 'data'),
    projectRoot: root,
    assetLibraryRoot: join(root, 'assets'),
  });
  cleanup.push(() => app.close());
  expect((await app.inject('/api/projects')).json().projects.some((p: any) => p.id === id)).toBe(
    true,
  );
  expect((await app.inject(`/api/projects/${id}`)).json().assets).toEqual(result.scene.assets);
  expect((await app.inject(asset.url)).statusCode).toBe(200);
  await generateWorld(options);
  expect(modelCalls).toBe(1);
  expect(creates).toBe(1);
  const outputPath = join(root, asset.url.slice(1)),
    expected = await readFile(outputPath);
  await unlink(outputPath);
  await generateWorld(options);
  expect(await readFile(outputPath)).toEqual(expected);
  await writeFile(outputPath, Buffer.from('corrupted cached output'));
  await generateWorld({ ...options, tripo: { ...options.tripo, key: 'rotated-tripo-key' } });
  expect(await readFile(outputPath)).toEqual(expected);
  await unlink(outputPath);
  await generateWorld({ ...options, tripo: { ...options.tripo, key: '' } });
  expect(await readFile(outputPath)).toEqual(expected);
  await unlink(outputPath);
  await unlink(join(root, 'assets', manifest.source));
  await generateWorld({ ...options, tripo: { ...options.tripo, key: 'rotated-tripo-key' } });
  expect(await readFile(outputPath)).toEqual(expected);
  expect(modelCalls).toBe(1);
  expect(creates).toBe(1);
  await expect(generateWorld({ ...options, description: 'Changed' })).rejects.toThrow(/exists/);
  expect(modelCalls).toBe(1);
  expect(creates).toBe(1);
});
it('repairs malformed world plans at most once and never publishes invalid provider data', async () => {
  const root = await temp();
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '{"scene":{}}' } }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const config = {
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
    model: 'fixture',
    key: 'fixture-key',
  };
  await expect(
    generateWorld({
      root,
      id: 'invalid',
      description: 'A world',
      planner: 'llm',
      assets: 'builtin',
      llm: config,
    }),
  ).rejects.toThrow(/two invalid/);
  expect(calls).toBe(2);
  await expect(readFile(join(root, 'worlds/invalid/scene.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
