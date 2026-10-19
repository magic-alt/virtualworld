import { realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { uploadPath } from '@virtualworld/scene-builder/asset-library';
import { within } from './export';
import { HttpError } from './store';

type FileLocation = { path: string; root: string };
export type AssetRoots = {
  uploadLibraryRoot: string;
  assetRoot: string;
  publicRoot: string;
  runtimeAssetRoots: string[];
};
async function findFile(candidates: FileLocation[]): Promise<FileLocation> {
  for (const candidate of candidates) {
    try {
      const actual = await realpath(candidate.path);
      const root = await realpath(candidate.root);
      const rel = relative(root, actual);
      if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
        throw new HttpError(404, '资源不在允许目录中');
      if (!(await stat(actual)).isFile()) throw new HttpError(404, '资源不是文件');
      return { path: actual, root };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new HttpError(404, '资源不存在');
}
export function resolveUploadFile(filename: string, roots: AssetRoots) {
  const path = uploadPath(roots.uploadLibraryRoot, filename);
  return findFile([
    { path, root: roots.uploadLibraryRoot },
    { path: join(roots.assetRoot, filename), root: roots.assetRoot },
  ]);
}
export function resolveAssetFile(
  asset: { url: string; type: 'glb' | 'splat' },
  roots: AssetRoots,
  checkType = true,
) {
  if (checkType && !(asset.type === 'glb' ? /\.glb$/i : /\.(ply|spz)$/i).test(asset.url))
    throw new HttpError(400, '源文件需要先转换为运行时模型');
  if (asset.url.startsWith('/api/assets/')) return resolveUploadFile(asset.url.slice(12), roots);
  if (asset.url.startsWith('/fixtures/'))
    return findFile([
      { path: within(roots.publicRoot, asset.url.slice(1)), root: roots.publicRoot },
    ]);
  if (asset.url.startsWith('/assets/optimized/'))
    return findFile(
      roots.runtimeAssetRoots.map((root) => ({
        path: within(root, asset.url.slice('/assets/'.length)),
        root,
      })),
    );
  throw new HttpError(400, '资源路径不可读取');
}
