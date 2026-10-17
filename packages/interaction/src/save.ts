import { z } from 'zod';
import type { SceneSpec } from '@virtualworld/scene-schema';
import { initialStory, type StoryState } from './story';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const Saved = z
  .object({
    version: z.literal(1),
    fingerprint: z.string(),
    state: z
      .object({
        flags: z.array(z.string()).max(5000),
        message: z.string().max(10000),
        completed: z.boolean(),
      })
      .strict(),
  })
  .strict();
function fingerprint(scene: SceneSpec) {
  const text = JSON.stringify({
    tasks: scene.tasks,
    interactions: scene.nodes.filter((n) => n.interaction).map((n) => [n.id, n.interaction]),
  });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export class SaveSystem {
  constructor(private storage?: StorageLike) {}
  static browser() {
    try {
      return new SaveSystem(window.localStorage);
    } catch {
      return new SaveSystem();
    }
  }
  private key(scene: SceneSpec) {
    return `virtualworld:progress:v1:${scene.id}`;
  }
  load(scene: SceneSpec): StoryState {
    try {
      const saved = Saved.parse(JSON.parse(this.storage?.getItem(this.key(scene)) || 'null'));
      if (saved.fingerprint !== fingerprint(scene)) return initialStory();
      // Replay reachability of granted flags: a syntactically valid save cannot skip prerequisites.
      const remaining = new Set(saved.state.flags),
        reachable = new Set<string>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of scene.nodes) {
          const x = n.interaction;
          if (
            x?.gives &&
            remaining.has(x.gives) &&
            (x.requires || []).every((f) => reachable.has(f))
          ) {
            remaining.delete(x.gives);
            reachable.add(x.gives);
            changed = true;
          }
        }
      }
      if (remaining.size) return initialStory();
      const canComplete = scene.nodes.some(
        (n) =>
          n.interaction?.completes &&
          (!n.interaction.gives || reachable.has(n.interaction.gives)) &&
          (n.interaction.requires || []).every((f) => reachable.has(f)),
      );
      return {
        ...saved.state,
        flags: [...new Set(saved.state.flags)],
        completed: saved.state.completed && canComplete,
      };
    } catch {
      return initialStory();
    }
  }
  save(scene: SceneSpec, state: StoryState) {
    try {
      this.storage?.setItem(
        this.key(scene),
        JSON.stringify({ version: 1, fingerprint: fingerprint(scene), state }),
      );
    } catch {}
  }
  reset(scene: SceneSpec) {
    try {
      this.storage?.removeItem(this.key(scene));
    } catch {}
  }
}
