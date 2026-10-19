import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { setImmediate as eventLoopTurn } from 'node:timers/promises';
import { createApp } from '../../apps/web/server/app';
import { ProjectStore } from '../../apps/web/server/store';
import { emptyScene } from '@virtualworld/scene-schema';

it('starts no compression after a real client disconnects during chapter preflight and releases admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-export-http-'));
  const playerRoot = join(root, 'player');
  await mkdir(playerRoot);
  await writeFile(join(playerRoot, 'player.html'), 'x');
  await writeFile(join(playerRoot, 'large.js'), randomBytes(4 * 1024 * 1024));
  const original = ProjectStore.prototype.checkChapter;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chapterCheck = vi
    .spyOn(ProjectStore.prototype, 'checkChapter')
    .mockImplementationOnce(async function (this: ProjectStore, scene) {
      enter();
      await blocked;
      return original.call(this, scene);
    });
  const app = await createApp({
    dataRoot: join(root, 'data'),
    projectRoot: root,
    playerRoot,
    accessPolicy: { mode: 'local', port: 3001 },
    llm: { baseUrl: '', key: '', model: '' },
  });
  try {
    let responseClosed!: () => void;
    const closedOnServer = new Promise<void>((resolve) => {
      responseClosed = resolve;
    });
    app.server.on('request', (incoming, response) => {
      if (incoming.url === '/api/export') response.once('close', responseClosed);
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const body = JSON.stringify({ scene: emptyScene() });
    const client = request({
      hostname: '127.0.0.1',
      port,
      path: '/api/export',
      method: 'POST',
      headers: {
        host: '127.0.0.1:3001',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    });
    client.on('error', () => {});
    client.end(body);
    await entered;
    const overloaded = await app.inject({
      method: 'POST',
      url: '/api/export',
      headers: { host: '127.0.0.1:3001' },
      payload: { scene: emptyScene() },
    });
    client.destroy();
    await closedOnServer;
    const workers = () =>
      process.getActiveResourcesInfo().filter((name) => name === 'MessagePort').length;
    const baseline = workers();
    release();
    let workerStarted = false;
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (workers() > baseline) {
        workerStarted = true;
        break;
      }
      await eventLoopTurn();
    }
    expect(workerStarted).toBe(false);
    expect(overloaded.statusCode).toBe(429);
    const next = await app.inject({
      method: 'POST',
      url: '/api/export',
      headers: { host: '127.0.0.1:3001' },
      payload: { scene: emptyScene() },
    });
    expect(next.statusCode).toBe(200);
    expect(next.headers['content-type']).toBe('application/zip');
  } finally {
    release();
    chapterCheck.mockRestore();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
