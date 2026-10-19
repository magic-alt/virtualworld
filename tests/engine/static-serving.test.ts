import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/web/server/app';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-static-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const studioRoot = join(root, 'web');
  const assetLibraryRoot = join(root, 'library');
  await mkdir(join(studioRoot, 'assets'), { recursive: true });
  await mkdir(join(assetLibraryRoot, 'optimized'), { recursive: true });
  await writeFile(join(studioRoot, 'index.html'), '<h1>World</h1>');
  await writeFile(join(studioRoot, 'assets/index-ABcd1234.js'), 'export const world = 1;');
  await writeFile(join(studioRoot, 'assets/manual.js'), 'export const mutable = 1;');
  const file = join(assetLibraryRoot, 'optimized/world.glb');
  await writeFile(file, 'glTF-first');
  const app = await createApp({ dataRoot: join(root, 'data'), studioRoot, assetLibraryRoot });
  cleanup.push(() => app.close());
  return { app, file };
}

it('serves static content with validators and empty conditional GET/HEAD responses', async () => {
  const { app } = await setup();
  const first = await app.inject('/assets/optimized/world.glb');
  expect(first.statusCode).toBe(200);
  expect(first.body).toBe('glTF-first');
  expect(first.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
  expect(first.headers['last-modified']).toBeDefined();
  expect(first.headers['content-length']).toBe('10');
  const cached = await app.inject({
    url: '/assets/optimized/world.glb',
    headers: { 'if-none-match': `"other", W/${first.headers.etag}` },
  });
  expect(cached.statusCode).toBe(304);
  expect(cached.body).toBe('');
  const head = await app.inject({ method: 'HEAD', url: '/assets/optimized/world.glb' });
  expect(head.statusCode).toBe(200);
  expect(head.headers.etag).toBe(first.headers.etag);
  expect(head.headers['content-length']).toBe('10');
  expect(head.body).toBe('');
  const cachedHead = await app.inject({
    method: 'HEAD',
    url: '/assets/optimized/world.glb',
    headers: { 'if-none-match': '*' },
  });
  expect(cachedHead.statusCode).toBe(304);
  expect(cachedHead.body).toBe('');
});

it('revalidates changed content even when URL, length and modification time stay unchanged', async () => {
  const { app, file } = await setup();
  const before = await stat(file);
  const first = await app.inject('/assets/optimized/world.glb');
  expect(first.headers.etag).toBeDefined();
  await writeFile(file, 'glTF-next!');
  await utimes(file, before.atime, before.mtime);
  const updated = await app.inject({
    url: '/assets/optimized/world.glb',
    headers: { 'if-none-match': first.headers.etag! },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.body).toBe('glTF-next!');
  expect(updated.headers.etag).not.toBe(first.headers.etag);
});

it('gives If-None-Match precedence over dates and honors valid date-only revalidation', async () => {
  const { app } = await setup();
  const first = await app.inject('/assets/optimized/world.glb');
  expect(first.headers['last-modified']).toBeDefined();
  const mismatched = await app.inject({
    url: '/assets/optimized/world.glb',
    headers: {
      'if-none-match': '"stale"',
      'if-modified-since': new Date(Date.now() + 60_000).toUTCString(),
    },
  });
  expect(mismatched.statusCode).toBe(200);
  const dated = await app.inject({
    url: '/assets/optimized/world.glb',
    headers: { 'if-modified-since': first.headers['last-modified']! },
  });
  expect(dated.statusCode).toBe(304);
  expect(dated.body).toBe('');
  expect(
    (
      await app.inject({
        url: '/assets/optimized/world.glb',
        headers: { 'if-modified-since': 'not-a-date' },
      })
    ).statusCode,
  ).toBe(200);
});

it('uses immutable caching only for hashed build scripts and keeps mutable URLs revalidated', async () => {
  const { app } = await setup();
  for (const url of ['/', '/index.html', '/assets/manual.js', '/assets/optimized/world.glb']) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  }
  const hashed = await app.inject('/assets/index-ABcd1234.js');
  expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await app.inject('/missing.glb')).statusCode).toBe(404);
});
