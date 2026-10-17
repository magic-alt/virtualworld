import { expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateWorld } from '../../generators/scene-builder/src/generate';
import { readWorld } from '@virtualworld/scene-builder/io';
import { advanceStory, initialStory } from '@virtualworld/interaction';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('generates different complete playable worlds through the same offline workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-worlds-'));
  roots.push(root);
  const a = await generateWorld({
    root,
    id: 'forest',
    description: 'A forest of blue crystals',
    planner: 'builtin',
    assets: 'builtin',
  });
  const b = await generateWorld({
    root,
    id: 'desert',
    description: 'A desert with golden rocks',
    planner: 'builtin',
    assets: 'builtin',
  });
  const forest = await readWorld(a.directory),
    desert = await readWorld(b.directory);
  expect(forest.environment).not.toEqual(desert.environment);
  expect(forest.nodes).not.toEqual(desert.nodes);
  let story = initialStory();
  for (const id of ['keeper', 'star', 'gate']) story = advanceStory(forest, story, id);
  expect(story.completed).toBe(true);
  expect(forest.nodes.some((n) => n.collider)).toBe(true);
  expect(
    (
      await generateWorld({
        root,
        id: 'forest',
        description: 'A forest of blue crystals',
        planner: 'builtin',
        assets: 'builtin',
      })
    ).directory,
  ).toBe(a.directory);
  await expect(
    generateWorld({
      root,
      id: 'forest',
      description: 'Different',
      planner: 'builtin',
      assets: 'builtin',
    }),
  ).rejects.toThrow(/exists/);
  const manifest = JSON.parse(await readFile(a.manifest, 'utf8'));
  expect(manifest.planner).toBe('builtin-procedural-v1');
  expect(manifest.descriptionSha256).toMatch(/^[a-f0-9]{64}$/);
});
