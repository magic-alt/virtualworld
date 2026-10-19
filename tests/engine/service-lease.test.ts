import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}));
import { acquireServiceLease } from '../../apps/web/server/service-lease';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'vw-lease-'));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
it('excludes a second owner, provides recovery instructions and releases idempotently', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  cleanups.push(release);
  await expect(acquireServiceLease(root)).rejects.toThrow(/lease.*Inspect.*stop/i);
  const owner = JSON.parse(await fs.readFile(join(root, '.service-lease/owner.json'), 'utf8'));
  expect(owner.pid).toBe(process.pid);
  expect(owner.token).toMatch(/^[a-f0-9-]+$/);
  await Promise.all([release(), release()]);
  const releaseAgain = await acquireServiceLease(root);
  await releaseAgain();
});
it('fails closed on an ambiguous stale lease without touching job state', async () => {
  const root = await setup();
  await fs.mkdir(join(root, '.service-lease'));
  await fs.mkdir(join(root, 'generations'));
  await fs.writeFile(join(root, 'generations/live.json'), 'active retained work');
  await expect(acquireServiceLease(root)).rejects.toThrow(/lease/);
  expect(await fs.readFile(join(root, 'generations/live.json'), 'utf8')).toBe(
    'active retained work',
  );
  expect(await fs.readdir(join(root, '.service-lease'))).toEqual([]);
});
it('cleans up its directory if writing owner metadata fails', async () => {
  const root = await setup();
  vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(
    Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
  );
  await expect(acquireServiceLease(root)).rejects.toThrow(/disk full/);
  const release = await acquireServiceLease(root);
  await release();
});
it('does not release a lease whose ownership record changed', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  const path = join(root, '.service-lease/owner.json');
  await fs.writeFile(path, JSON.stringify({ token: 'different-owner' }));
  await expect(release()).rejects.toThrow(/ownership/);
  expect(JSON.parse(await fs.readFile(path, 'utf8')).token).toBe('different-owner');
});
it('treats an already removed lease directory as an idempotent release', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  await fs.rm(root, { recursive: true });
  await expect(Promise.all([release(), release()])).resolves.toEqual([undefined, undefined]);
});
it('fails closed when the lease directory still exists but its ownership file is missing', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  await fs.unlink(join(root, '.service-lease/owner.json'));
  await expect(release()).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readdir(join(root, '.service-lease'))).toEqual([]);
});
it('does not release a replacement directory even if its copied ownership token matches', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  const directory = join(root, '.service-lease');
  const owner = await fs.readFile(join(directory, 'owner.json'), 'utf8');
  await fs.rename(directory, join(root, 'original-lease'));
  await fs.mkdir(directory);
  await fs.writeFile(join(directory, 'owner.json'), owner);
  await expect(release()).rejects.toThrow(/ownership changed/);
  expect(await fs.readFile(join(directory, 'owner.json'), 'utf8')).toBe(owner);
});
it('excludes an independent Node process using the same workspace', async () => {
  const root = await setup();
  const release = await acquireServiceLease(root);
  cleanups.push(release);
  const source = `import { acquireServiceLease } from './apps/web/server/service-lease.ts';
    try { await acquireServiceLease(process.argv[1]); process.exitCode = 2; }
    catch (error) { if (!String(error).includes('service lease')) throw error; }`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source, root],
    { cwd: process.cwd() },
  );
  expect(result.stderr).toBe('');
});
