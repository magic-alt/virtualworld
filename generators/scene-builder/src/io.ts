import { readFile, readdir, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CampaignSchema, type SceneSpec, type CampaignSpec } from '@virtualworld/scene-schema';
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
  return (
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map(async (e) => {
          try {
            const manifest = CampaignSchema.parse(
              JSON.parse(await readFile(join(root, e.name, 'campaign.json'), 'utf8')),
            );
            return Promise.all(
              manifest.chapters.map(async (chapter, index) => {
                const directory = `${e.name}/${chapter.directory}`;
                const scene = await readWorld(inside(root, directory));
                if (
                  scene.id !== chapter.id ||
                  scene.campaign?.id !== manifest.id ||
                  scene.campaign.index !== index
                )
                  throw new Error(`Campaign chapter metadata mismatch: ${chapter.id}`);
                return { directory, scene };
              }),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return [{ directory: e.name, scene: await readWorld(join(root, e.name)) }];
          }
        }),
    )
  ).flat();
}
export async function listCampaigns(root: string): Promise<CampaignSpec[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const campaigns = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map(async (e) => {
        try {
          return CampaignSchema.parse(
            JSON.parse(await readFile(join(root, e.name, 'campaign.json'), 'utf8')),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }),
  );
  return campaigns.filter((c): c is CampaignSpec => c !== null);
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
