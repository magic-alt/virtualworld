import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as io from '@virtualworld/scene-builder/io';
import { ProjectStore } from '../../apps/web/server/store';
import { industrialDemo } from '../fixtures/scenes';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vw-catalog-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const bundled = join(root, 'bundled'),
    generated = join(root, 'generated');
  const store = new ProjectStore(join(root, 'data'), bundled, [generated]);
  return { root, bundled, generated, store };
}
const scene = (id: string) => ({ ...industrialDemo(), id });
it.each(['get', 'save'] as const)(
  'keeps a valid saved project %s independent of an unrelated malformed world',
  async (operation) => {
    const f = await setup();
    const saved = scene('saved-independent');
    await f.store.save(saved.id, saved, 0);
    await io.writeWorld(f.generated, scene('broken-world'));
    await writeFile(join(f.generated, 'broken-world/scene.json'), 'not valid JSON');
    const catalogReads = vi.spyOn(io, 'listWorlds');
    const result =
      operation === 'get'
        ? await f.store.get(saved.id)
        : await f.store.save(saved.id, { ...saved, name: 'Edited saved project', revision: 1 }, 0);
    expect(result.id).toBe(saved.id);
    expect(result.revision).toBe(operation === 'get' ? 0 : 1);
    expect(catalogReads).not.toHaveBeenCalled();
    // Listing still detects catalog corruption; the saved-first path is deliberately narrow.
    await expect(f.store.list()).rejects.toThrow();
  },
);
it('reads each world root once per list, overlays saves and discovers later publications', async () => {
  const f = await setup();
  await io.writeWorld(f.bundled, scene('bundle-one'));
  await io.writeWorld(f.generated, scene('generated-one'));
  await f.store.save(
    'bundle-one',
    { ...scene('bundle-one'), revision: 1, name: 'Saved override' },
    0,
  );
  const read = vi.spyOn(io, 'listWorlds');
  const list = await f.store.list();
  expect(read.mock.calls.map(([root]) => root)).toEqual([f.bundled, f.generated]);
  expect(list.map((s) => [s.id, s.name])).toContainEqual(['bundle-one', 'Saved override']);
  expect(list.map((s) => s.id)).toContain('generated-one');
  await io.writeWorld(f.generated, scene('generated-two'));
  expect((await f.store.list()).map((s) => s.id)).toContain('generated-two');
  expect((await f.store.get('generated-one')).id).toBe('generated-one');
});
it('rejects duplicate world IDs across roots instead of silently selecting one', async () => {
  const f = await setup();
  await io.writeWorld(f.bundled, scene('duplicate-world'));
  await io.writeWorld(f.generated, scene('duplicate-world'));
  await expect(f.store.list()).rejects.toThrow(/Duplicate world ID/);
  await expect(f.store.get('duplicate-world')).rejects.toThrow(/Duplicate world ID/);
});
it('reads generated campaigns and validates saved chapter metadata using the shared catalog', async () => {
  const f = await setup();
  const manifest = {
    version: 1,
    id: 'generated-campaign',
    title: 'Campaign',
    description: 'Fixture',
    chapters: [{ id: 'generated-chapter', title: 'Chapter', directory: 'chapter' }],
  };
  await mkdir(join(f.generated, 'campaign'), { recursive: true });
  await writeFile(join(f.generated, 'campaign', 'campaign.json'), JSON.stringify(manifest));
  const chapter = {
    ...scene('generated-chapter'),
    campaign: { id: manifest.id, chapterId: 'generated-chapter', index: 0 },
  };
  await io.writeWorld(join(f.generated, 'campaign'), {
    ...chapter,
    id: 'chapter',
    campaign: { ...chapter.campaign, chapterId: 'chapter' },
  });
  // writeWorld names its directory by ID; the persisted scene must keep the chapter's real identity.
  const { splitWorld } = await import('@virtualworld/scene-builder');
  for (const [name, value] of Object.entries(splitWorld(chapter)))
    await writeFile(join(f.generated, 'campaign/chapter', `${name}.json`), JSON.stringify(value));
  expect((await f.store.campaign(manifest.id)).scenes[0].id).toBe(chapter.id);
  await mkdir(join(f.root, 'data/projects'), { recursive: true });
  await writeFile(
    join(f.root, 'data/projects', `${chapter.id}.json`),
    JSON.stringify({ ...chapter, campaign: undefined }),
  );
  await expect(f.store.list()).rejects.toThrow(/metadata mismatch/);
});
it('keeps retired projects hidden across all roots', async () => {
  const f = await setup();
  await io.writeWorld(f.generated, scene('demo-world'));
  expect(await f.store.list()).toEqual([]);
  await expect(f.store.get('demo-world')).rejects.toMatchObject({ statusCode: 404 });
});
