import { expect, it, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { TripoProvider } from '@virtualworld/tripo';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
async function fixture(mode: 'success' | 'uncertain' | 'failed' | 'running' = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'vw-tripo-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const doc = new Document();
  doc.createScene();
  const glb = await new NodeIO().writeBinary(doc);
  const state = { creates: 0, polls: 0, downloadAuth: '', body: {} as any };
  let baseUrl = '';
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/generation/')) {
      state.creates++;
      const chunks = [];
      for await (const c of req) chunks.push(c);
      state.body = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'uncertain') {
        res.writeHead(503);
        res.end('{}');
        return;
      }
      res.end(JSON.stringify({ code: 0, data: { task_id: 'task_fixture' } }));
      return;
    }
    if (req.url?.startsWith('/tasks/')) {
      state.polls++;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          code: 0,
          data: {
            task_id: 'task_fixture',
            status: mode === 'failed' ? 'failed' : mode === 'running' ? 'running' : 'success',
            output: { model_url: baseUrl + '/model.glb' },
          },
        }),
      );
      return;
    }
    state.downloadAuth = String(req.headers.authorization || '');
    res.end(glb);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  cleanups.push(() => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))));
  const options = {
    baseUrl,
    key: 'secret-fixture-only',
    model: 'v3.1-20260211',
    cacheRoot: join(root, 'jobs'),
    sourceRoot: join(root, 'source'),
    pollIntervalMs: 1,
    timeoutMs: 1000,
  };
  return { root, state, options };
}
it('creates one billed task for concurrent identical requests and resumes from disk cache', async () => {
  const { state, options } = await fixture(),
    provider = new TripoProvider(options);
  const request = { prompt: 'A star-shaped lantern' };
  const [a, b] = await Promise.all([provider.generate(request), provider.generate(request)]);
  expect(a.taskId).toBe(b.taskId);
  expect(state.creates).toBe(1);
  const cached = await new TripoProvider(options).generate(request);
  expect(cached.cacheHit).toBe(true);
  expect(state.creates).toBe(1);
  expect(state.body).toMatchObject({
    prompt: request.prompt,
    model: options.model,
    texture: true,
    pbr: true,
  });
  expect(state.downloadAuth).toBe('');
  const ledger = await readFile(
    join(options.cacheRoot, (await readdir(options.cacheRoot)).find((p) => p.endsWith('.json'))!),
    'utf8',
  );
  expect(ledger).not.toContain(options.key);
});
it('does not retry task creation after an ambiguous provider error', async () => {
  const { state, options } = await fixture('uncertain'),
    p = new TripoProvider(options);
  await expect(p.generate({ prompt: 'A lantern' })).rejects.toThrow(/uncertain/i);
  await expect(new TripoProvider(options).generate({ prompt: 'A lantern' })).rejects.toThrow(
    /uncertain/i,
  );
  expect(state.creates).toBe(1);
});
it('handles failed jobs without recreating them and uses image-to-model when supplied', async () => {
  const { state, options } = await fixture('failed'),
    p = new TripoProvider(options);
  await expect(
    p.generate({ prompt: 'Lantern', image: 'https://example.com/lantern.png' }),
  ).rejects.toThrow(/failed/);
  expect(state.body.input).toBe('https://example.com/lantern.png');
  expect(state.body.prompt).toBeUndefined();
  await expect(
    p.generate({ prompt: 'Lantern', image: 'https://example.com/lantern.png' }),
  ).rejects.toThrow(/failed/);
  expect(state.creates).toBe(1);
});
it('bounds polling time and resumes the same task after timeout', async () => {
  const { state, options } = await fixture('running');
  await expect(
    new TripoProvider({ ...options, timeoutMs: 70 }).generate({ prompt: 'Lantern' }),
  ).rejects.toThrow();
  const polls = state.polls;
  await expect(
    new TripoProvider({ ...options, timeoutMs: 70 }).generate({ prompt: 'Lantern' }),
  ).rejects.toThrow();
  expect(state.creates).toBe(1);
  expect(state.polls).toBeGreaterThan(polls);
});
