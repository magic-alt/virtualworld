import { readFile, readdir, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SceneSpec } from '@virtualworld/scene-schema';
import { assembleWorld, splitWorld } from './index';
import { atomicWrite } from './pipeline';

export function inside(root: string, path: string) {
  const absolute = resolve(root, path),
    rel = relative(resolve(root), absolute);
  if (
    isAbsolute(path) ||
    rel === '..' ||
    rel.startsWith('..\\') ||
    rel.startsWith('../') ||
    isAbsolute(rel)
  )
    throw new Error('Path escapes project root');
  return absolute;
}
export async function readWorld(directory: string) {
  const docs = await Promise.all(
    ['scene', 'story', 'assets'].map(async (name) =>
      JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8')),
    ),
  );
  return assembleWorld(...(docs as [unknown, unknown, unknown]));
}
export async function listWorlds(root: string): Promise<{ directory: string; scene: SceneSpec }[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map(async (e) => ({ directory: e.name, scene: await readWorld(join(root, e.name)) })),
  );
}
/** All documents are validated before an atomic directory publish; never overwrite an existing world. */
export async function writeWorld(root: string, scene: SceneSpec) {
  const bundle = splitWorld(scene);
  assembleWorld(bundle.scene, bundle.story, bundle.assets);
  const target = inside(root, scene.id);
  try {
    const old = await readWorld(target);
    if (
      JSON.stringify(old) ===
      JSON.stringify(assembleWorld(bundle.scene, bundle.story, bundle.assets))
    )
      return target;
    throw new Error(`World ${scene.id} already exists; choose a new --id`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(root, { recursive: true });
  const temp = inside(root, `.${scene.id}-${randomUUID()}`);
  await mkdir(temp);
  try {
    for (const [name, doc] of Object.entries(bundle))
      await atomicWrite(join(temp, `${name}.json`), JSON.stringify(doc, null, 2) + '\n');
    await rename(temp, target);
  } catch (e) {
    // Only remove our own verified temporary directory, never the requested world.
    await rm(temp, { recursive: true, force: true });
    throw e;
  }
  return target;
}
