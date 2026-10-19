import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const worker = vi.hoisted(() => ({ run: vi.fn() }));
// Hold the actual worker boundary deterministically; this suite never calls a paid provider.
vi.mock('@virtualworld/scene-builder/generate', () => ({ generateWorld: worker.run }));
import { GenerationService } from '../../apps/web/server/generation';
const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  worker.run.mockImplementation(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
});
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  worker.run.mockReset();
});
const input = (requestId: string) => ({
  requestId,
  description: 'A forest',
  planner: 'builtin',
  assets: 'builtin',
});
async function setup(maxPending = 1) {
  const root = await mkdtemp(join(tmpdir(), 'vw-capacity-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const service = new GenerationService(
    root,
    root,
    { baseUrl: '', key: '', model: '' },
    { maxPending },
  );
  await service.init();
  cleanups.push(() => service.close());
  return { service, root };
}
it('bounds active plus queued jobs, allows replay while full, and leaves rejected jobs absent', async () => {
  const { service, root } = await setup(2);
  const first = await service.create(input('request-first'));
  await service.create(input('request-second'));
  expect(service.capacity()).toEqual({ maxPending: 2, pending: 2, available: 0, closed: false });
  expect((await service.create(input(first.id))).id).toBe(first.id);
  await expect(service.create(input('request-rejected'))).rejects.toMatchObject({
    statusCode: 429,
  });
  expect(await readdir(join(root, 'generations'))).toEqual([
    'request-first.json',
    'request-second.json',
  ]);
  expect(() => service.get('request-rejected')).toThrow(/不存在/);
  expect(worker.run).toHaveBeenCalledTimes(1);
  await expect(
    service.create({ ...input(first.id), description: 'different' }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
it('releases admission after completion and failure', async () => {
  const { service } = await setup();
  worker.run.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fixture failure'));
  await service.create(input('request-complete'));
  await vi.waitFor(() => expect(service.get('request-complete').phase).toBe('complete'));
  expect(service.capacity().pending).toBe(0);
  await service.create(input('request-failure'));
  await vi.waitFor(() => expect(service.get('request-failure').phase).toBe('failed'));
  expect(service.capacity().available).toBe(1);
});
it('rejects resume at capacity without changing its retained phase', async () => {
  const { service, root } = await setup();
  const failed = input('request-recovery');
  await mkdir(join(root, 'generations'), { recursive: true });
  await writeFile(
    join(root, 'generations', `${failed.requestId}.json`),
    JSON.stringify({
      version: 1,
      id: failed.requestId,
      worldId: `world-${failed.requestId}`,
      input: failed,
      phase: 'failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  await service.init();
  await service.create(input('request-blocking'));
  await expect(service.resume(failed.requestId, {})).rejects.toMatchObject({ statusCode: 429 });
  expect(
    JSON.parse(await readFile(join(root, 'generations', `${failed.requestId}.json`), 'utf8')).phase,
  ).toBe('failed');
});
it('closes admission immediately and releases active and queued capacity on shutdown', async () => {
  const { service } = await setup(2);
  await service.create(input('request-active'));
  await service.create(input('request-queued'));
  const closing = service.close();
  await expect(service.create(input('request-too-late'))).rejects.toMatchObject({
    statusCode: 503,
  });
  await expect(service.resume('request-active', {})).rejects.toMatchObject({ statusCode: 503 });
  await closing;
  expect(service.capacity()).toEqual({ maxPending: 2, pending: 0, available: 2, closed: true });
  expect(service.get('request-queued').phase).toBe('interrupted');
});
it('defaults to eight outstanding jobs and rejects invalid capacities', () => {
  const config = { baseUrl: '', key: '', model: '' };
  expect(new GenerationService('/unused', '/unused', config).capacity().maxPending).toBe(8);
  for (const maxPending of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => new GenerationService('/unused', '/unused', config, { maxPending })).toThrow(
      /maxPending/,
    );
});
