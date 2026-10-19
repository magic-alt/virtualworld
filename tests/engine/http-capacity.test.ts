import { afterEach, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyScene } from '@virtualworld/scene-schema';
import { createApp } from '../../apps/web/server/app';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const headers = { host: 'localhost:3001' };
const binaryHeaders = { ...headers, 'content-type': 'application/octet-stream' };

async function setup(llm = { baseUrl: '', key: '', model: '' }) {
  const root = await mkdtemp(join(tmpdir(), 'vw-http-capacity-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = await createApp({
    dataRoot: root,
    projectRoot: root,
    llm,
    accessPolicy: { mode: 'local', port: 3001 },
  });
  cleanup.push(() => app.close());
  return { app, root };
}

async function heldModel() {
  const requests: { url?: string; payload: unknown }[] = [];
  const pending = new Set<ServerResponse>();
  const events = new EventEmitter();
  let automatic = false;
  const respond = (response: ServerResponse) => {
    if (response.destroyed || response.writableEnded) return;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Local HTTP capacity fixture',
                commands: [{ type: 'renameProject', name: 'Accepted local proposal' }],
              }),
            },
          },
        ],
      }),
    );
  };
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const part of request) body += part;
      requests.push({ url: request.url, payload: JSON.parse(body) });
      pending.add(response);
      response.once('close', () => pending.delete(response));
      events.emit('request');
      if (automatic) respond(response);
    })().catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local model fixture did not bind');
  const release = () => {
    automatic = true;
    for (const response of pending) respond(response);
  };
  cleanup.push(async () => {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return {
    requests,
    release,
    config: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      key: 'local-test-key',
      model: 'local-fixture',
    },
    waitForRequests: async (count: number) => {
      while (requests.length < count)
        await once(events, 'request', { signal: AbortSignal.timeout(5000) });
    },
  };
}

it('admits two HTTP agent calls, rejects overflow before provider IO, and keeps health responsive', async () => {
  const model = await heldModel();
  const { app } = await setup(model.config);
  const inFlight: Promise<unknown>[] = [];
  cleanup.push(async () => {
    model.release();
    await Promise.allSettled(inFlight);
  });
  const payload = { scene: emptyScene(), prompt: 'Rename this project' };
  const call = () => {
    const request = app.inject({ method: 'POST', url: '/api/agent', headers, payload });
    inFlight.push(request);
    return request;
  };
  const first = call();
  const second = call();
  // The provider requests themselves form the barrier; no timing sleeps are needed.
  await model.waitForRequests(2);
  const overflow = await call();
  expect(overflow.statusCode).toBe(429);
  expect(overflow.headers['retry-after']).toBe('2');
  expect(model.requests).toHaveLength(2);
  expect(model.requests.every((request) => request.url === '/v1/chat/completions')).toBe(true);
  const health = await app.inject({ url: '/healthz', headers });
  expect(health.statusCode).toBe(200);
  expect(health.json()).toEqual({ ok: true });
  const busy = await app.inject({ url: '/api/service', headers });
  expect(busy.json()).toMatchObject({ limits: { maxAgentRequests: 2 }, operations: { agents: 2 } });

  model.release();
  for (const response of await Promise.all([first, second])) {
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      projectId: payload.scene.id,
      baseRevision: payload.scene.revision,
      commands: [{ type: 'renameProject', name: 'Accepted local proposal' }],
    });
  }
  const next = await call();
  expect(next.statusCode).toBe(200);
  expect(model.requests).toHaveLength(3);
  expect((await app.inject({ url: '/api/service', headers })).json().operations.agents).toBe(0);
});

it('enforces the default 2 MiB JSON limit while permitting larger STEP source uploads', async () => {
  const { app } = await setup();
  const oversizedJson = JSON.stringify({
    scene: emptyScene(),
    padding: 'x'.repeat(2 * 1024 * 1024),
  });
  expect(Buffer.byteLength(oversizedJson)).toBeGreaterThan(2 * 1024 * 1024);
  const json = await app.inject({
    method: 'POST',
    url: '/api/validate',
    headers: { ...headers, 'content-type': 'application/json' },
    payload: oversizedJson,
  });
  expect(json.statusCode).toBe(413);

  // A legal STEP comment grows the existing local CAD fixture without changing its geometry.
  const cube = await readFile(new URL('../../public/fixtures/cube.step', import.meta.url), 'utf8');
  const step = Buffer.from(
    cube.replace('ISO-10303-21;', `ISO-10303-21;\n/*${' '.repeat(2 * 1024 * 1024)}*/\n`),
  );
  expect(step.length).toBeGreaterThan(2 * 1024 * 1024);
  const source = await app.inject({
    method: 'POST',
    url: '/api/assets?name=large-cube.step',
    headers: binaryHeaders,
    payload: step,
  });
  expect(source.statusCode).toBe(200);
  expect(source.json()).toMatchObject({ type: 'source', bytes: step.length });
  const downloaded = await app.inject({ url: source.json().url, headers });
  expect(downloaded.statusCode).toBe(200);
  expect(downloaded.rawPayload.equals(step)).toBe(true);
});

it('enforces the 20 MiB reference route limit before storing an oversized octet-stream body', async () => {
  const { app, root } = await setup();
  const bytes = Buffer.alloc(20 * 1024 * 1024 + 1);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/generation/references?name=oversized.png',
    headers: binaryHeaders,
    payload: bytes,
  });
  expect(response.statusCode).toBe(413);
  expect(await readdir(join(root, 'references'))).toEqual([]);
  expect((await app.inject({ url: '/healthz', headers })).statusCode).toBe(200);
});
