import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative, extname, isAbsolute } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import {
  assertScene,
  CampaignSchema,
  type CampaignSpec,
  type SceneSpec,
} from '@virtualworld/scene-schema';
import { HttpError } from './store';
import { readUpload } from '@virtualworld/scene-builder/asset-library';
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
  options: {
    playerRoot: string;
    assetRoot: string;
    publicRoot: string;
    assetLibraryRoot?: string;
    runtimeAssetRoot?: string;
    campaign?: { manifest: CampaignSpec; scenes: SceneSpec[] };
  },
) {
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
  for (const current of scenes)
    for (const asset of current.assets) {
      let path: string;
      if (asset.url.startsWith('/api/assets/'))
        path = within(options.assetRoot, asset.url.slice('/api/assets/'.length));
      else if (asset.url.startsWith('/fixtures/'))
        path = within(options.publicRoot, asset.url.slice(1));
      else if (asset.url.startsWith('/assets/optimized/') && options.assetLibraryRoot)
        path = within(
          options.runtimeAssetRoot || options.assetLibraryRoot,
          asset.url.slice('/assets/'.length),
        );
      else throw new HttpError(400, `资源路径不可导出: ${asset.name}`);
      let data: Buffer;
      try {
        data =
          asset.url.startsWith('/api/assets/') && options.assetLibraryRoot
            ? await readUpload(options.assetLibraryRoot, options.assetRoot, asset.url.slice(12))
            : await readFile(path);
      } catch {
        throw new HttpError(400, `资源缺失: ${asset.name}`);
      }
      const name = campaign
        ? `assets/scene-${createHash('sha256').update(data).digest('hex').slice(0, 24)}${extname(path)}`
        : `assets/scene-${asset.id}${extname(path)}`;
      files[name] = new Uint8Array(data);
      asset.url = name;
      asset.bytes = data.length;
      delete asset.source;
    }
  files['scene.json'] = strToU8(JSON.stringify(scenes[0]));
  if (campaign) {
    campaign.chapters.forEach((chapter, index) => {
      chapter.directory = `chapters/${chapter.id}`;
      files[`${chapter.directory}/scene.json`] = strToU8(JSON.stringify(scenes[index]));
    });
    files['campaign.json'] = strToU8(JSON.stringify(campaign));
  }
  files['README.txt'] = strToU8(
    'VirtualWorld Studio export\nServe this directory over HTTP (not file://). Open index.html. No API service or API key is required.\n',
  );
  files['LICENSES.txt'] = strToU8(
    'Scene samples: original VirtualWorld Studio content.\nRuntime dependencies: Three.js (MIT), Spark (MIT), Rapier (Apache-2.0), fflate (MIT).\nSee THIRD_PARTY_NOTICES.md in the source distribution for license text and source URLs.\n',
  );
  if (campaign?.id === 'little-prince')
    files['ATTRIBUTION.txt'] = strToU8(
      'Little Prince three-chapter adaptation\nStory source: Antoine de Saint-Exupery, Le Petit Prince, chapters II, V-IX, XX-XXI.\nFrench text: https://www.ebooksgratuits.com/html/st_exupery_le_petit_prince.html\nChinese dialogue is an original paraphrase; character and environment geometry are original VirtualWorld Studio work. This is a selected-chapter adaptation, not a reproduction of the full book.\n',
    );
  try {
    files['THIRD_PARTY_NOTICES.md'] = new Uint8Array(
      await readFile(resolve('THIRD_PARTY_NOTICES.md')),
    );
  } catch {}
  return Buffer.from(zipSync(files, { level: 6 }));
}
