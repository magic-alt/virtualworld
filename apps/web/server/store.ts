import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertScene, type SceneSpec, type CampaignSpec } from '@virtualworld/scene-schema';
import { listWorlds, listCampaigns } from '@virtualworld/scene-builder/io';
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const retiredProjects = new Set([
  'demo-industrial',
  'demo-world',
  'generated-desert',
  'generated-forest',
]);
export class ProjectStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    public root: string,
    private worldsRoot = resolve('worlds'),
    private additionalWorldRoots: string[] = [],
  ) {}
  private worldRoots() {
    return [
      ...new Set([this.worldsRoot, ...this.additionalWorldRoots].map((root) => resolve(root))),
    ];
  }
  private async catalog() {
    const scenes = new Map<string, SceneSpec>();
    for (const root of this.worldRoots())
      for (const world of await listWorlds(root)) {
        if (retiredProjects.has(world.scene.id)) continue;
        if (scenes.has(world.scene.id))
          throw new Error(`Duplicate world ID across world catalogs: ${world.scene.id}`);
        scenes.set(world.scene.id, world.scene);
      }
    const campaigns = await this.campaigns();
    for (const scene of scenes.values()) this.validateChapter(scene, campaigns);
    return { scenes, campaigns };
  }
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(400, '非法项目 ID');
    return join(this.root, 'projects', `${id}.json`);
  }
  async checkChapter(scene: SceneSpec) {
    return this.validateChapter(scene, await this.campaigns());
  }
  private validateChapter(scene: SceneSpec, manifests: CampaignSpec[]) {
    if (retiredProjects.has(scene.id)) throw new HttpError(400, '该示例已删除');
    const manifest = manifests.find((m) => m.chapters.some((c) => c.id === scene.id));
    if (manifest) {
      const index = manifest.chapters.findIndex((c) => c.id === scene.id);
      if (
        scene.campaign?.id !== manifest.id ||
        scene.campaign.chapterId !== scene.id ||
        scene.campaign.index !== index
      )
        throw new HttpError(400, `Campaign chapter metadata mismatch: ${scene.id}`);
    } else if (scene.campaign) throw new HttpError(400, 'Unknown campaign chapter');
    return scene;
  }
  async get(id: string): Promise<SceneSpec> {
    if (retiredProjects.has(id)) throw new HttpError(404, '该示例已删除');
    // Saved projects must remain usable when an unrelated source bundle is corrupt.
    try {
      return await this.checkChapter(await this.readSaved(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.getFromCatalog(id, await this.catalog());
  }
  private async readSaved(id: string) {
    const scene = assertScene(JSON.parse(await readFile(this.path(id), 'utf8')));
    if (scene.id !== id) throw new HttpError(400, '项目 ID 不匹配');
    return scene;
  }
  private async getFromCatalog(
    id: string,
    catalog: { scenes: Map<string, SceneSpec>; campaigns: CampaignSpec[] },
  ): Promise<SceneSpec> {
    if (retiredProjects.has(id)) throw new HttpError(404, '该示例已删除');
    try {
      const scene = await this.readSaved(id);
      return this.validateChapter(scene, catalog.campaigns);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const world = catalog.scenes.get(id);
      if (world) return world;
      throw new HttpError(404, '项目不存在');
    }
  }
  async campaigns() {
    const campaigns = new Map<string, CampaignSpec>();
    const chapterIds = new Set<string>();
    for (const root of this.worldRoots())
      for (const manifest of await listCampaigns(root)) {
        if (campaigns.has(manifest.id))
          throw new Error(`Duplicate campaign ID across world catalogs: ${manifest.id}`);
        for (const chapter of manifest.chapters) {
          if (chapterIds.has(chapter.id))
            throw new Error(`Duplicate chapter ID across campaigns: ${chapter.id}`);
          chapterIds.add(chapter.id);
        }
        campaigns.set(manifest.id, manifest);
      }
    return [...campaigns.values()];
  }
  async campaign(id: string) {
    const catalog = await this.catalog();
    const manifest = catalog.campaigns.find((c) => c.id === id);
    if (!manifest) throw new HttpError(404, '章节合集不存在');
    return {
      manifest,
      scenes: await Promise.all(manifest.chapters.map((c) => this.getFromCatalog(c.id, catalog))),
    };
  }
  async list() {
    await mkdir(join(this.root, 'projects'), { recursive: true });
    const catalog = await this.catalog();
    const ids = new Set(catalog.scenes.keys());
    for (const file of await readdir(join(this.root, 'projects')))
      if (file.endsWith('.json') && !retiredProjects.has(file.slice(0, -5)))
        ids.add(file.slice(0, -5));
    return Promise.all(
      [...ids].map(async (id) => {
        const s = await this.getFromCatalog(id, catalog);
        return {
          id: s.id,
          name: s.name,
          mode: s.mode,
          revision: s.revision,
          description: s.description,
        };
      }),
    );
  }
  async save(id: string, input: unknown, baseRevision: number) {
    const scene = assertScene(input);
    await this.checkChapter(scene);
    if (scene.id !== id) throw new HttpError(400, '项目 ID 不匹配');
    const previousQueue = this.queues.get(id) || Promise.resolve();
    const operation = previousQueue
      .catch(() => {})
      .then(async () => {
        const path = this.path(id);
        let previous: SceneSpec | undefined;
        try {
          previous = await this.get(id);
        } catch (e) {
          if (!(e instanceof HttpError && e.statusCode === 404)) throw e;
        }
        if (previous && baseRevision !== previous.revision)
          throw new HttpError(409, '修订冲突，磁盘上的项目已更新，请重新打开');
        if (previous && scene.revision < previous.revision)
          throw new HttpError(409, '不能覆盖较新的修订');
        if (
          previous &&
          scene.revision === previous.revision &&
          JSON.stringify(scene) !== JSON.stringify(previous)
        )
          throw new HttpError(409, '内容修改必须增加修订号');
        await mkdir(join(this.root, 'projects'), { recursive: true });
        const temp = `${path}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(scene, null, 2));
        await rename(temp, path);
        return scene;
      });
    this.queues.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.queues.get(id) === operation) this.queues.delete(id);
    }
  }
}
