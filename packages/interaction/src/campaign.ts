import type { CampaignSpec, SceneSpec } from '@virtualworld/scene-schema';
import { SaveSystem } from './save';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const selections = new Map<string, string>();
const sessionOnly = new Set<string>();

/** Chapter unlocks derive from validated scene saves, never a separate trusted completion flag. */
export class CampaignProgress {
  private saves: SaveSystem;
  constructor(
    private manifest: CampaignSpec,
    private scenes: SceneSpec[],
    private storage?: StorageLike,
  ) {
    this.saves = new SaveSystem(storage);
    if (manifest.chapters.some((chapter) => !scenes.some((scene) => scene.id === chapter.id)))
      throw new Error('Campaign is missing a chapter scene');
  }
  static browser(manifest: CampaignSpec, scenes: SceneSpec[]) {
    let storage: StorageLike | undefined;
    try {
      storage = window.localStorage;
    } catch {}
    return new CampaignProgress(manifest, scenes, storage);
  }
  private key() {
    return `virtualworld:campaign:v1:${this.manifest.id}`;
  }
  status() {
    const completed = new Set<string>();
    return this.manifest.chapters.map((chapter) => {
      const unlocked = (chapter.requires || []).every((id) => completed.has(id));
      const done =
        unlocked &&
        this.saves.load(this.scenes.find((scene) => scene.id === chapter.id)!).completed;
      if (done) completed.add(chapter.id);
      return { id: chapter.id, title: chapter.title, unlocked, completed: done };
    });
  }
  current() {
    try {
      let id: string | null | undefined;
      try {
        id = sessionOnly.has(this.key())
          ? selections.get(this.key())
          : this.storage?.getItem(this.key()) || selections.get(this.key());
      } catch {
        id = selections.get(this.key());
      }
      if (this.status().some((chapter) => chapter.id === id && chapter.unlocked)) return id!;
    } catch {}
    return this.manifest.chapters[0].id;
  }
  select(id: string) {
    if (!this.status().some((chapter) => chapter.id === id && chapter.unlocked))
      throw new Error('Chapter is locked or unknown');
    selections.set(this.key(), id);
    try {
      this.storage?.setItem(this.key(), id);
      sessionOnly.delete(this.key());
    } catch {
      sessionOnly.add(this.key());
    }
    return this.scenes.find((scene) => scene.id === id)!;
  }
  updateScene(scene: SceneSpec) {
    if (!this.scenes.some((chapter) => chapter.id === scene.id))
      throw new Error('Chapter is unknown');
    this.scenes = this.scenes.map((chapter) =>
      chapter.id === scene.id ? structuredClone(scene) : chapter,
    );
  }
  reset() {
    this.scenes.forEach((scene) => this.saves.reset(scene));
    selections.delete(this.key());
    sessionOnly.delete(this.key());
    try {
      this.storage?.removeItem(this.key());
    } catch {}
  }
}
