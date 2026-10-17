import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative, extname, isAbsolute } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { assertScene, type SceneSpec } from '../../../packages/scene/src/schema';
import { HttpError } from './store';
export async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
export function within(root: string, path: string) {
  if (isAbsolute(path)) throw new HttpError(400, '非法资源路径');
  const absolute = resolve(root, path),
    rel = relative(resolve(root), absolute);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw new HttpError(400, '非法资源路径');
  return absolute;
}
export async function createExport(
  input: SceneSpec,
  options: { playerRoot: string; assetRoot: string; publicRoot: string },
) {
  const scene = structuredClone(assertScene(input));
  const files: Record<string, Uint8Array> = {};
  let playerFiles: string[];
  try {
    playerFiles = await walk(options.playerRoot);
  } catch {
    throw new HttpError(503, '播放器尚未构建，请先运行 npm run build');
  }
  for (const file of playerFiles) {
    const name = relative(options.playerRoot, file).replaceAll('\\', '/');
    if (name.startsWith('fixtures/')) continue;
    files[name === 'player.html' ? 'index.html' : name] = new Uint8Array(await readFile(file));
  }
  if (!files['index.html']) throw new HttpError(503, '播放器构建不完整');
  for (const asset of scene.assets) {
    let path: string;
    if (asset.url.startsWith('/api/assets/'))
      path = within(options.assetRoot, asset.url.slice('/api/assets/'.length));
    else if (asset.url.startsWith('/fixtures/'))
      path = within(options.publicRoot, asset.url.slice(1));
    else throw new HttpError(400, `资源路径不可导出: ${asset.name}`);
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      throw new HttpError(400, `资源缺失: ${asset.name}`);
    }
    const name = `assets/scene-${asset.id}${extname(path)}`;
    files[name] = new Uint8Array(data);
    asset.url = name;
    asset.bytes = data.length;
    delete asset.source;
  }
  files['scene.json'] = strToU8(JSON.stringify(scene));
  files['README.txt'] = strToU8(
    'VirtualWorld Studio export\nServe this directory over HTTP (not file://). Open index.html. No API service or API key is required.\n',
  );
  files['LICENSES.txt'] = strToU8(
    'Scene samples: original VirtualWorld Studio content.\nRuntime dependencies: Three.js (MIT), Spark (MIT), Rapier (Apache-2.0), fflate (MIT).\nSee THIRD_PARTY_NOTICES.md in the source distribution for license text and source URLs.\n',
  );
  try {
    files['THIRD_PARTY_NOTICES.md'] = new Uint8Array(
      await readFile(resolve('THIRD_PARTY_NOTICES.md')),
    );
  } catch {}
  return Buffer.from(zipSync(files, { level: 6 }));
}
