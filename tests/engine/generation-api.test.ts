import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { builtinPlan } from '@virtualworld/planner/world';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/web/server/app';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.unstubAllEnvs();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-generation-api-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = await createApp({
    dataRoot: join(root, 'data'),
    projectRoot: root,
    llm: { baseUrl: '', model: '', key: '' },
  });
  cleanup.push(() => app.close());
  return { app, root };
}
const input = {
  requestId: 'request-forest-001',
  description: '蓝色晶石与古树环绕的森林',
  planner: 'builtin',
  assets: 'builtin',
};
it('publishes an offline generated world and deduplicates concurrent requests durably', async () => {
  const { app, root } = await setup();
  const responses = await Promise.all(
    [1, 2].map(() => app.inject({ method: 'POST', url: '/api/generations', payload: input })),
  );
  expect(responses.map((r) => r.statusCode)).toEqual([202, 202]);
  expect(responses[0].json().id).toBe(responses[1].json().id);
  let job = responses[0].json();
  for (let i = 0; i < 100 && !['complete', 'failed'].includes(job.phase); i++) {
    await new Promise((r) => setTimeout(r, 10));
    job = (await app.inject(`/api/generations/${job.id}`)).json();
  }
  expect(job.phase).toBe('complete');
  const scene = (await app.inject(`/api/projects/${job.worldId}`)).json();
  expect(scene.nodes.some((n: any) => n.collider)).toBe(true);
  expect((await app.inject('/api/projects')).json().projects.map((p: any) => p.id)).toContain(
    scene.id,
  );
  const disk = await readFile(join(root, 'data/generations', `${job.id}.json`), 'utf8');
  expect(JSON.parse(disk).phase).toBe('complete');
  expect(disk).not.toMatch(/API_KEY|Bearer/);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/generations',
        payload: { ...input, description: 'other' },
      })
    ).statusCode,
  ).toBe(409);
});
it('rejects missing model configuration, implicit paid generation and arbitrary references', async () => {
  const { app } = await setup();
  expect((await app.inject('/api/generation/capabilities')).json().llm).toBe(false);
  for (const patch of [
    { planner: 'llm' },
    { assets: 'tripo' },
    { referenceId: '../../.env' },
    { description: '   ' },
    { referenceImage: 'C:/secret.png' },
  ]) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/generations',
          payload: { ...input, ...patch },
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/generation/references?name=bad.png',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('not an image'),
      })
    ).statusCode,
  ).toBe(400);
  expect((await app.inject('/api/generations/../../secret')).statusCode).toBe(404);
});
it('marks retained active jobs interrupted on restart without submitting them again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-generation-restart-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'data/generations');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${input.requestId}.json`),
    JSON.stringify({
      version: 1,
      id: input.requestId,
      worldId: `world-${input.requestId}`,
      input,
      phase: 'assets',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  const app = await createApp({ dataRoot: join(root, 'data'), projectRoot: root });
  cleanup.push(() => app.close());
  const job = (await app.inject(`/api/generations/${input.requestId}`)).json();
  expect(job.phase).toBe('interrupted');
  expect((await app.inject('/api/projects')).json().projects).toEqual([]);
  const replay = await app.inject({ method: 'POST', url: '/api/generations', payload: input });
  expect(replay.json().phase).toBe('interrupted');
});
it('retains the original paid provider scope across credential and model changes during explicit recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-paid-recovery-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let creates = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url?.includes('chat/completions')) {
      const payload = JSON.parse(body),
        id = payload.messages[0].content.match(/Return scene id exactly ([a-zA-Z0-9_-]+)/)[1];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(builtinPlan({ id, description: 'a forest' })) } },
          ],
        }),
      );
    } else {
      creates++;
      req.socket.destroy();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubEnv('TRIPO_API_KEY', 'original-private-key');
  vi.stubEnv('TRIPO_BASE_URL', `${base}/v3`);
  vi.stubEnv('TRIPO_MODEL', 'fixture-v1');
  const app = await createApp({
    dataRoot: join(root, 'data'),
    projectRoot: root,
    llm: { baseUrl: `${base}/v1`, key: 'private-llm-key', model: 'fixture' },
  });
  cleanup.push(() => app.close());
  const payload = { ...input, planner: 'llm', assets: 'tripo', allowPaid: true };
  const accepted = await app.inject({ method: 'POST', url: '/api/generations', payload });
  expect(accepted.statusCode).toBe(202);
  async function failed() {
    for (let i = 0; i < 100; i++) {
      const job = (await app.inject(`/api/generations/${input.requestId}`)).json();
      if (job.phase === 'failed') return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Task did not fail');
  }
  await failed();
  expect(creates).toBe(1);
  vi.stubEnv('TRIPO_API_KEY', 'rotated-private-key');
  vi.stubEnv('TRIPO_MODEL', 'fixture-v2');
  await app.inject({
    method: 'POST',
    url: `/api/generations/${input.requestId}/resume`,
    payload: {},
  });
  const job = await failed();
  expect(creates).toBe(1);
  expect(job.error).toMatch(/uncertain/);
  expect(JSON.stringify(job)).not.toContain('private-key');
});
