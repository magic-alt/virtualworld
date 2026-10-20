import { readdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, relative, extname, isAbsolute } from 'node:path';
import { Zip, AsyncZipDeflate, strToU8 } from 'fflate';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import {
  assertScene,
  CampaignSchema,
  type CampaignSpec,
  type SceneSpec,
} from '@virtualworld/scene-schema';
import { HttpError } from './store';
import { uploadPath } from '@virtualworld/scene-builder/asset-library';
import { validateGlb } from '@virtualworld/scene-builder/pipeline';
import { writeEngineExport, type EngineTarget } from '@virtualworld/scene-builder/engine-export';
import { primitive } from '@virtualworld/engine/geometry';
export async function walk(root: string, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    signal?.throwIfAborted();
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, signal)));
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
  options: {
    playerRoot: string;
    target?: 'web' | EngineTarget;
    assetRoot: string;
    publicRoot: string;
    assetLibraryRoot?: string;
    runtimeAssetRoot?: string;
    additionalRuntimeAssetRoots?: string[];
    maxBytes?: number;
    signal?: AbortSignal;
    campaign?: { manifest: CampaignSpec; scenes: SceneSpec[] };
  },
) {
  const { signal } = options;
  const target = options.target ?? 'web';
  if (!['web', 'unity', 'godot', 'unreal'].includes(target))
    throw new HttpError(400, '非法导出目标');
  const checkCancelled = () => signal?.throwIfAborted();
  checkCancelled();
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new HttpError(400, '导出大小上限必须是正整数');
  const scene = structuredClone(assertScene(input));
  const campaign = options.campaign ? CampaignSchema.parse(options.campaign.manifest) : undefined;
  if (scene.campaign && (!campaign || campaign.id !== scene.campaign.id))
    throw new HttpError(400, '章节合集不完整，无法导出');
  if (campaign && !campaign.chapters.some((chapter) => chapter.id === scene.id))
    throw new HttpError(400, 'Current scene is not a campaign chapter');
  const scenes = campaign
    ? campaign.chapters.map((chapter, index) => {
        const chapterScene =
          chapter.id === scene.id
            ? scene
            : options.campaign!.scenes.find((s) => s.id === chapter.id);
        if (!chapterScene) throw new HttpError(400, `章节缺失: ${chapter.id}`);
        const parsed = assertScene(chapterScene);
        if (
          parsed.campaign?.id !== campaign.id ||
          parsed.campaign.chapterId !== chapter.id ||
          parsed.campaign.index !== index
        )
          throw new HttpError(400, `Campaign chapter metadata mismatch: ${chapter.id}`);
        return structuredClone(parsed);
      })
    : [scene];
  const files: Record<string, Uint8Array> = Object.create(null);
  const sources = new Map<string, Buffer>();
  const assetContents = new Map<string, Buffer>();
  let totalBytes = 0;
  const ensureBudget = (bytes: number) => {
    if (bytes > maxBytes - totalBytes) throw new HttpError(413, '导出未压缩内容超过大小上限');
  };
  const add = (name: string, data: Uint8Array) => {
    checkCancelled();
    const previous = files[name]?.byteLength ?? 0;
    ensureBudget(data.byteLength - previous);
    totalBytes += data.byteLength - previous;
    files[name] = data;
  };
  // Open the canonical contained file, stat before allocation, and read only that
  // stat's size. Concurrent growth cannot make readFile allocate beyond the cap.
  const readContained = async (root: string, file: string, contentSuffix?: string) => {
    checkCancelled();
    const actualRoot = await realpath(root);
    const actual = await realpath(file);
    within(actualRoot, relative(actualRoot, actual));
    const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile()) throw new HttpError(400, '导出资源不是普通文件');
      const key = `${actual}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      const cached = sources.get(key);
      if (cached) return cached;
      const size = Number(info.size);
      const verifySnapshot = async () => {
        checkCancelled();
        const after = await handle.stat({ bigint: true });
        if (
          after.size !== info.size ||
          after.mtimeNs !== info.mtimeNs ||
          after.ctimeNs !== info.ctimeNs
        )
          throw new HttpError(409, '导出期间资源发生变化，请重试');
      };
      if (size > maxBytes - totalBytes && contentSuffix) {
        // A different path can contain an already-budgeted campaign asset. Hash
        // in bounded scratch space before allocating another full-size buffer.
        const possibleDuplicate = [...assetContents].some(
          ([key, data]) => key.endsWith(contentSuffix) && data.length === size,
        );
        if (!possibleDuplicate) ensureBudget(size);
        const hash = createHash('sha256');
        const scratch = Buffer.alloc(Math.min(64 * 1024, size));
        let offset = 0;
        while (offset < size) {
          checkCancelled();
          const { bytesRead } = await handle.read(
            scratch,
            0,
            Math.min(scratch.length, size - offset),
            offset,
          );
          if (!bytesRead) throw new HttpError(409, '导出期间资源发生变化，请重试');
          hash.update(scratch.subarray(0, bytesRead));
          offset += bytesRead;
        }
        await verifySnapshot();
        const shared = assetContents.get(`${hash.digest('hex')}${contentSuffix}`);
        if (shared) {
          sources.set(key, shared);
          return shared;
        }
      }
      ensureBudget(size);
      const data = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        checkCancelled();
        const { bytesRead } = await handle.read(
          data,
          offset,
          Math.min(64 * 1024, size - offset),
          offset,
        );
        if (!bytesRead) throw new HttpError(409, '导出期间资源发生变化，请重试');
        offset += bytesRead;
      }
      await verifySnapshot();
      sources.set(key, data);
      return data;
    } finally {
      await handle.close();
    }
  };
  const readCandidates = async (
    candidates: { root: string; file: string }[],
    contentSuffix: string,
  ) => {
    let missing: unknown;
    for (const { root, file } of candidates) {
      try {
        return await readContained(root, file, contentSuffix);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        missing = error;
      }
    }
    throw missing;
  };
  if (target === 'web') {
    let playerFiles: string[];
    try {
      playerFiles = await walk(options.playerRoot, signal);
    } catch (error) {
      checkCancelled();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new HttpError(503, '播放器尚未构建，请先运行 npm run build');
    }
    for (const file of playerFiles) {
      const name = relative(options.playerRoot, file).replaceAll('\\', '/');
      if (name.startsWith('fixtures/')) continue;
      add(
        name === 'player.html' ? 'index.html' : name,
        await readContained(options.playerRoot, file),
      );
    }
    if (!files['index.html']) throw new HttpError(503, '播放器构建不完整');
  }
  for (const current of scenes)
    for (const asset of current.assets) {
      checkCancelled();
      const suffix = extname(asset.url).toLowerCase();
      if (
        (asset.type === 'glb' && suffix !== '.glb') ||
        (asset.type === 'splat' && !['.ply', '.spz'].includes(suffix))
      )
        throw new HttpError(400, `资源不是受支持的运行时格式: ${asset.name}`);
      const candidates: { root: string; file: string }[] = [];
      if (asset.url.startsWith('/api/assets/')) {
        const filename = asset.url.slice('/api/assets/'.length);
        if (!/^[a-f0-9]{64}\.(glb|spz|ply)$/.test(filename))
          throw new HttpError(400, '非法运行时上传路径');
        if (options.assetLibraryRoot)
          candidates.push({
            root: options.assetLibraryRoot,
            file: uploadPath(options.assetLibraryRoot, filename),
          });
        candidates.push({ root: options.assetRoot, file: within(options.assetRoot, filename) });
      } else if (asset.url.startsWith('/fixtures/')) {
        candidates.push({
          root: options.publicRoot,
          file: within(options.publicRoot, asset.url.slice(1)),
        });
      } else if (asset.url.startsWith('/assets/optimized/')) {
        const roots = [
          options.runtimeAssetRoot || options.assetLibraryRoot,
          ...(options.additionalRuntimeAssetRoots ?? []),
        ];
        for (const root of roots)
          if (root)
            candidates.push({ root, file: within(root, asset.url.slice('/assets/'.length)) });
      }
      if (!candidates.length) throw new HttpError(400, `资源路径不可导出: ${asset.name}`);
      let data: Buffer;
      try {
        data = await readCandidates(candidates, suffix);
      } catch (error) {
        checkCancelled();
        if (error instanceof HttpError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new HttpError(400, `资源缺失: ${asset.name}`);
        throw error;
      }
      const digest = createHash('sha256').update(data).digest('hex');
      if (asset.url.startsWith('/api/assets/') && !asset.url.endsWith(`/${digest}${suffix}`))
        throw new HttpError(400, `上传资源完整性校验失败: ${asset.name}`);
      const contentKey = `${digest}${suffix}`;
      const shared = assetContents.get(contentKey);
      if (shared) {
        // Distinct paths with identical content must retain only one actual buffer.
        for (const [key, source] of sources) if (source === data) sources.set(key, shared);
        data = shared;
      } else {
        if (asset.type === 'glb') {
          try {
            await validateGlb(data);
          } catch {
            throw new HttpError(400, `GLB 资源校验失败: ${asset.name}`);
          }
          checkCancelled();
        }
        assetContents.set(contentKey, data);
      }
      const name = campaign
        ? `assets/scene-${digest.slice(0, 24)}${suffix}`
        : `assets/scene-${asset.id}${suffix}`;
      add(name, data);
      asset.url = name;
      asset.bytes = data.length;
      delete asset.source;
    }
  add('scene.json', strToU8(JSON.stringify(scenes[0])));
  if (campaign) {
    campaign.chapters.forEach((chapter, index) => {
      chapter.directory = `chapters/${chapter.id}`;
      add(`${chapter.directory}/scene.json`, strToU8(JSON.stringify(scenes[index])));
    });
    add('campaign.json', strToU8(JSON.stringify(campaign)));
  }
  if (target === 'web') {
    add(
      'README.txt',
      strToU8(
        'VirtualWorld Studio export\nServe this directory over HTTP (not file://). Open index.html. No API service or API key is required.\n',
      ),
    );
  } else {
    await writeEngineExport({
      target,
      scenes,
      entrySceneId: scene.id,
      campaign,
      assetBytes: (url) => {
        const bytes = files[url];
        if (!bytes) throw new HttpError(400, '导出资源快照缺失');
        return bytes;
      },
      primitiveFactory: primitive,
      emit: add,
      signal,
    });
  }
  add(
    'LICENSES.txt',
    strToU8(
      'Scene samples: original VirtualWorld Studio content.\nRuntime dependencies: Three.js (MIT), Spark (MIT), Rapier (Apache-2.0), fflate (MIT).\nSee THIRD_PARTY_NOTICES.md in the source distribution for license text and source URLs.\n',
    ),
  );
  if (campaign?.id === 'little-prince')
    add(
      'ATTRIBUTION.txt',
      strToU8(
        'Little Prince three-chapter adaptation\nStory source: Antoine de Saint-Exupery, Le Petit Prince, chapters II, V-IX, XX-XXI.\nFrench text: https://www.ebooksgratuits.com/html/st_exupery_le_petit_prince.html\nChinese dialogue is an original paraphrase; character and environment geometry are original VirtualWorld Studio work. This is a selected-chapter adaptation, not a reproduction of the full book.\n',
      ),
    );
  try {
    const noticeRoot = resolve('.');
    add(
      'THIRD_PARTY_NOTICES.md',
      await readContained(noticeRoot, join(noticeRoot, 'THIRD_PARTY_NOTICES.md')),
    );
  } catch (error) {
    checkCancelled();
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  checkCancelled();
  // One asynchronous deflater at a time bounds worker memory even for many
  // assets. The archive is still accumulated in memory, including its output.
  return new Promise<Buffer>((resolveZip, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) {
        archive.terminate();
        chunks.length = 0;
        reject(error);
      } else resolveZip(Buffer.concat(chunks));
    };
    const abort = () =>
      finish(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    const archive = new Zip((error, data, final) => {
      if (settled) return;
      if (error) return finish(error);
      chunks.push(data);
      if (final) finish();
    });
    signal?.addEventListener('abort', abort, { once: true });
    void (async () => {
      checkCancelled();
      for (const [name, data] of Object.entries(files)) {
        checkCancelled();
        if (settled) return;
        await new Promise<void>((complete, fail) => {
          const entry = new AsyncZipDeflate(name, { level: 6 });
          archive.add(entry);
          const ondata = entry.ondata!;
          entry.ondata = (error, chunk, final) => {
            ondata(error, chunk, final);
            if (error) fail(error);
            else if (final) complete();
          };
          void (async () => {
            for (let offset = 0; offset < data.length; offset += 64 * 1024) {
              checkCancelled();
              if (settled) return;
              const end = Math.min(data.length, offset + 64 * 1024);
              // AsyncZipDeflate transfers each chunk's ArrayBuffer. Copy this
              // bounded slice so shared archive/source buffers stay intact.
              entry.push(Uint8Array.from(data.subarray(offset, end)), end === data.length);
              await yieldToEventLoop();
            }
            if (!data.length) entry.push(data, true);
          })().catch(fail);
        });
      }
      if (!settled) archive.end();
    })().catch(finish);
  });
}
