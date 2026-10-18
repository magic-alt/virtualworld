import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../../apps/web/server/app';
import { propose } from '@virtualworld/planner';
import { within } from '../../apps/web/server/export';
import { industrialDemo } from '../fixtures/scenes';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const playerRoot = join(root, 'player');
  await mkdir(playerRoot);
  await writeFile(join(playerRoot, 'player.html'), '<script src="./assets/player.js"></script>');
  await mkdir(join(playerRoot, 'assets'));
  await writeFile(join(playerRoot, 'assets/player.js'), 'console.log("player")');
  const app = await createApp({ dataRoot: root, playerRoot });
  cleanups.push(() => app.close());
  const seeded = await app.inject({
    method: 'PUT',
    url: '/api/projects/test-industrial',
    payload: { scene: industrialDemo(), baseRevision: 0 },
  });
  expect(seeded.statusCode).toBe(200);
  return app;
}
describe('local project API', () => {
  it('lists both usable templates without API credentials', async () => {
    const app = await setup();
    const r = await app.inject('/api/projects');
    expect(r.statusCode).toBe(200);
    expect(r.json().projects.map((p: any) => p.id)).toEqual(
      expect.arrayContaining(['demo-harmonic-joint', 'little-prince-desert']),
    );
    expect(r.json().aiConfigured).toBe(false);
  });
  it('saves and reloads edits and rejects stale saves without overwriting', async () => {
    const app = await setup();
    const scene = industrialDemo();
    scene.name = 'Edited';
    scene.revision = 1;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          payload: { scene, baseRevision: 0 },
        })
      ).statusCode,
    ).toBe(200);
    const stale = { ...scene, name: 'Stale', revision: 2 };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          payload: { scene: stale, baseRevision: 0 },
        })
      ).statusCode,
    ).toBe(409);
    expect((await app.inject('/api/projects/test-industrial')).json().name).toBe('Edited');
  });
  it('rejects invalid scenes and cross-origin writes', async () => {
    const app = await setup();
    const scene = industrialDemo();
    scene.nodes[0].assetId = 'missing';
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          payload: { scene, baseRevision: 0 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          headers: { origin: 'https://evil.example' },
          payload: { scene: industrialDemo(), baseRevision: 0 },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('stores assets by digest and rejects unsafe filenames and formats', async () => {
    const app = await setup();
    const upload = await app.inject({
      method: 'POST',
      url: '/api/assets?name=part.glb',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('glTF-test'),
    });
    expect(upload.statusCode).toBe(200);
    const asset = upload.json();
    expect(asset.url).toMatch(/^\/api\/assets\/[a-f0-9]{64}\.glb$/);
    expect((await app.inject(asset.url)).rawPayload.toString()).toBe('glTF-test');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/assets?name=..%2Fbad.glb',
          headers: { 'content-type': 'application/octet-stream' },
          payload: Buffer.from('x'),
        })
      ).statusCode,
    ).toBe(400);
  });
  it('exports relative assets and never exports credentials', async () => {
    const app = await setup();
    const r = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { scene: industrialDemo() },
    });
    expect(r.statusCode).toBe(200);
    const files = unzipSync(r.rawPayload);
    expect(files['index.html']).toBeDefined();
    expect(files['scene.json']).toBeDefined();
    expect(files['assets/player.js']).toBeDefined();
    expect(strFromU8(files['scene.json'])).not.toContain('API_KEY');
  });
  it('returns an explicit unavailable error when AI is not configured', async () => {
    const app = await setup();
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent',
      payload: { scene: industrialDemo(), prompt: 'Turn the shaft green' },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatch(/配置/);
  });
  it('rejects changed content at an unchanged revision', async () => {
    const app = await setup();
    const scene = industrialDemo();
    scene.name = 'Bypass revision';
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          payload: { scene, baseRevision: 0 },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('allows only one winner for concurrent writes sharing a base revision', async () => {
    const app = await setup();
    const a = { ...industrialDemo(), name: 'A', revision: 1 },
      b = { ...industrialDemo(), name: 'B', revision: 1 };
    const responses = await Promise.all(
      [a, b].map((scene) =>
        app.inject({
          method: 'PUT',
          url: '/api/projects/test-industrial',
          payload: { scene, baseRevision: 0 },
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  it('keeps resolved paths inside the intended asset root', () => {
    expect(() => within(join(tmpdir(), 'safe'), '../escaped.txt')).toThrow();
    expect(within(join(tmpdir(), 'safe'), 'nested/file.glb')).toBe(
      join(tmpdir(), 'safe', 'nested', 'file.glb'),
    );
  });
});
describe('compatible LLM provider', () => {
  async function model(responses: string[]) {
    let calls = 0;
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      requests.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: responses[Math.min(calls++, responses.length - 1)],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address() as { port: number };
    return {
      config: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test', key: 'test-only' },
      requests,
    };
  }
  it('validates a real HTTP response into an applicable local edit', async () => {
    const m = await model([
      JSON.stringify({
        summary: 'Change shaft color',
        commands: [{ type: 'updateNode', id: 'shaft', patch: { color: '#00ff00' } }],
      }),
    ]);
    const result = await propose(
      { scene: industrialDemo(), prompt: 'Make shaft green', selectedId: 'shaft' },
      m.config,
    );
    expect(result.baseRevision).toBe(0);
    expect(result.commands[0].type).toBe('updateNode');
    if (result.commands[0].type === 'updateNode')
      expect(result.commands[0].patch.color).toBe('#00ff00');
    expect(m.requests[0].messages[1].content).toContain('Make shaft green');
    expect(m.requests[0].model).toBe('test');
  });
  it('repairs invalid model output once, then rejects without changing input', async () => {
    const m = await model([
      'not json',
      JSON.stringify({
        summary: 'Bad',
        commands: [{ type: 'updateNode', id: 'not-here', patch: { name: 'x' } }],
      }),
    ]);
    const scene = industrialDemo();
    await expect(propose({ scene, prompt: 'change' }, m.config)).rejects.toThrow();
    expect(m.requests).toHaveLength(2);
    expect(scene.revision).toBe(0);
  });
  it('never allows AI output to impersonate human confirmation of a joint', async () => {
    const m = await model([
      JSON.stringify({
        summary: 'Change joint',
        commands: [
          {
            type: 'updateNode',
            id: 'shaft',
            patch: { joint: { axis: 'y', min: -1, max: 1, value: 0, confirmed: true } },
          },
        ],
      }),
    ]);
    const proposal = await propose(
      { scene: industrialDemo(), prompt: 'Change rotation limit' },
      m.config,
    );
    const c = proposal.commands[0];
    expect(c.type).toBe('updateNode');
    if (c.type === 'updateNode') expect(c.patch.joint?.confirmed).toBe(false);
  });
});
