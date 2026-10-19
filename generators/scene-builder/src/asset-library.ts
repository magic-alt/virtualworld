import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { atomicWrite, sha256, validateGlb } from './pipeline';
export function uploadPath(root: string, filename: string) {
  if (!/^[a-f0-9]{64}\.(glb|step|stp|spz|ply)$/.test(filename))
    throw new Error('Invalid upload asset path');
  const raw = ['.step', '.stp'].includes(extname(filename));
  return join(root, raw ? 'source' : 'optimized', 'uploads', filename);
}
export async function recordUpload(
  root: string,
  bytes: Buffer,
  name: string,
  sourceAssetId?: string,
) {
  if (sourceAssetId && !/^a-[a-f0-9]{20}$/.test(sourceAssetId))
    throw new Error('Invalid source asset ID');
  const extension = extname(name).toLowerCase();
  if (!['.glb', '.step', '.stp', '.spz', '.ply'].includes(extension))
    throw new Error('Unsupported upload asset format');
  // Publication is the trust boundary, including callers bypassing browser checks.
  // Complete validation before even creating a source file or its directories.
  const validation = extension === '.glb' ? await validateGlb(bytes) : undefined;
  const hash = sha256(bytes),
    filename = hash + extension;
  const source = join(root, 'source', 'uploads', filename);
  await atomicWrite(source, bytes);
  const runtime = uploadPath(root, filename);
  if (runtime !== source) await atomicWrite(runtime, bytes);
  const manifest = {
    version: 1,
    id: `a-${hash.slice(0, 20)}`,
    name,
    sourceSha256: hash,
    outputSha256: hash,
    bytes: bytes.length,
    source: `source/uploads/${filename}`,
    output: runtime === source ? null : `optimized/uploads/${filename}`,
    sourceAssetId,
    processing: 'uploaded bytes; no server optimization',
    createdAt: new Date().toISOString(),
    tools: { ingestion: 'scene-builder/1' },
    ...(validation ? { validation } : {}),
  };
  await atomicWrite(
    join(root, 'manifests', 'uploads', `${hash}${extname(name).toLowerCase()}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { filename, manifest };
}
export async function readUpload(root: string, legacyRoot: string, filename: string) {
  try {
    return await readFile(uploadPath(root, filename));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return readFile(join(legacyRoot, filename));
  }
}
