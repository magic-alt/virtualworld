import { createHash } from 'node:crypto';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { extname, relative, isAbsolute } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './store';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
// Keep only small validators, never model buffers. ctime detects same-size writes with restored mtime.
const validators = new Map<string, { identity: string; etag: string }>();
const MAX_VALIDATORS = 64;
export async function serveStatic(
  file: string,
  root: string,
  req: FastifyRequest,
  reply: FastifyReply,
  immutable = false,
) {
  let handle: FileHandle;
  try {
    const [actual, actualRoot] = await Promise.all([realpath(file), realpath(root)]);
    const rel = relative(actualRoot, actual);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
      throw new Error('Outside static root');
    handle = await open(actual, 'r');
  } catch {
    throw new HttpError(404, '文件不存在');
  }
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw new HttpError(404, '文件不存在');
    const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    let cached = validators.get(file);
    if (cached?.identity !== identity) {
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 }))
        hash.update(chunk);
      cached = { identity, etag: `"${hash.digest('hex')}"` };
    }
    validators.delete(file);
    validators.set(file, cached);
    if (validators.size > MAX_VALIDATORS) validators.delete(validators.keys().next().value!);
    const modified = new Date(Number(info.mtimeMs));
    reply
      .type(types[extname(file).toLowerCase()] || 'application/octet-stream')
      .header(
        'Cache-Control',
        immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      )
      .header('ETag', cached.etag)
      .header('Last-Modified', modified.toUTCString());
    const match = req.headers['if-none-match'];
    const since = req.headers['if-modified-since'];
    // If-None-Match takes precedence even when it does not match; GET/HEAD use weak comparison.
    const notModified =
      match !== undefined
        ? match
            .split(',')
            .some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === cached.etag)
        : since !== undefined &&
          Number.isFinite(Date.parse(since)) &&
          Math.floor(modified.getTime() / 1000) <= Math.floor(Date.parse(since) / 1000);
    if (notModified) {
      await handle.close();
      return reply.code(304).send();
    }
    reply.header('Content-Length', info.size.toString());
    if (req.method === 'HEAD') {
      await handle.close();
      return reply.send();
    }
    // The response stream owns the descriptor until Fastify completes or aborts delivery.
    return reply.send(handle.createReadStream({ start: 0 }));
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}
