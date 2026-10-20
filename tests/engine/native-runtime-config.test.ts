import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readServerConfig } from '../../apps/web/server/config';
import { createApp } from '../../apps/web/server/app';
import { engineCapabilities } from '../../apps/web/shared/engine-runtime';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const binding = {
  engine: 'unity',
  sceneId: 'demo-harmonic-joint',
  revision: 0,
  url: 'http://127.0.0.1:8080/index.html',
  default: true,
};
it('keeps an explicitly selected stale default visible instead of silently starting Three', () => {
  expect(
    engineCapabilities({ id: 'demo-harmonic-joint', revision: 2 }, [
      { ...binding, engine: 'unity' },
    ]),
  ).toMatchObject({
    defaultEngine: 'unity',
    engines: [
      { id: 'unity', status: 'stale' },
      { id: 'unreal', status: 'missing' },
    ],
  });
});
it('parses explicitly configured builds and rejects ambiguous or executable runtime URLs', () => {
  expect(readServerConfig({ VW_ENGINE_RUNTIMES: JSON.stringify([binding]) })).toMatchObject({
    engineRuntimes: [binding],
  });
  for (const entries of [
    [{ ...binding, url: 'javascript:alert(1)' }],
    [{ ...binding, url: 'file:///tmp/player.html' }],
    [{ ...binding, url: 'https://user:password@example.com/player' }],
    [{ ...binding, engine: 'typo' }],
    [{ ...binding, revision: -1 }],
    [binding, binding],
    [binding, { ...binding, engine: 'unreal' }],
  ])
    expect(() => readServerConfig({ VW_ENGINE_RUNTIMES: JSON.stringify(entries) })).toThrow();
  expect(() => readServerConfig({ VW_ENGINE_RUNTIMES: '{broken' })).toThrow();
});

it('binds advertised engine builds to the requested saved scene and revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-native-config-'));
  roots.push(root);
  const app = await createApp({
    ...readServerConfig({
      VW_ENGINE_RUNTIMES: JSON.stringify([
        binding,
        { ...binding, engine: 'unreal', revision: 999, default: false },
        { ...binding, sceneId: 'little-prince-desert', url: 'http://127.0.0.1:8081/' },
      ]),
    }),
    dataRoot: root,
    projectRoot: resolve('.'),
  });
  try {
    const get = (id: string) =>
      app.inject({
        method: 'GET',
        url: `/api/projects/${id}/engines`,
        headers: { host: '127.0.0.1:3001' },
      });
    const scene = (
      await app.inject({
        method: 'GET',
        url: '/api/projects/demo-harmonic-joint',
        headers: { host: '127.0.0.1:3001' },
      })
    ).json();
    const response = await get('demo-harmonic-joint');
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.sceneId).toBe('demo-harmonic-joint');
    expect(data.revision).toBe(scene.revision);
    expect(data.engines).toHaveLength(2);
    const unity = data.engines.find((entry: { id: string }) => entry.id === 'unity');
    expect(unity.status).toBe(scene.revision === 0 ? 'configured' : 'stale');
    expect(data.engines.find((entry: { id: string }) => entry.id === 'unreal')).toMatchObject({
      status: 'stale',
    });
    expect(data.engines.find((entry: { id: string }) => entry.id === 'unreal').url).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('8081');
    expect((await get('little-prince-b612')).json()).toMatchObject({
      defaultEngine: 'web',
      engines: [{ status: 'missing' }, { status: 'missing' }],
    });
    expect((await get('not-a-project')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
