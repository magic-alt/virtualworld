import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertScene, type SceneSpec } from '@virtualworld/scene-schema';
import { industrialDemo, worldDemo } from '@virtualworld/scene-builder';
import { readWorld, listWorlds } from '@virtualworld/scene-builder/io';
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export class ProjectStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    public root: string,
    private worldsRoot = resolve('worlds'),
  ) {}
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(400, '非法项目 ID');
    return join(this.root, 'projects', `${id}.json`);
  }
  async get(id: string): Promise<SceneSpec> {
    try {
      return assertScene(JSON.parse(await readFile(this.path(id), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (id === 'demo-industrial') return industrialDemo();
      if (id === 'demo-world') return worldDemo();
      try {
        return await readWorld(join(this.worldsRoot, id));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      throw new HttpError(404, '项目不存在');
    }
  }
  async list() {
    await mkdir(join(this.root, 'projects'), { recursive: true });
    const ids = new Set(['demo-industrial', 'demo-world']);
    for (const world of await listWorlds(this.worldsRoot)) ids.add(world.scene.id);
    for (const file of await readdir(join(this.root, 'projects')))
      if (file.endsWith('.json')) ids.add(file.slice(0, -5));
    return Promise.all(
      [...ids].map(async (id) => {
        const s = await this.get(id);
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
