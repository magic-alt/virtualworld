import { expect, it } from 'vitest';
import { CampaignSchema } from '@virtualworld/scene-schema';
import { CampaignProgress } from '@virtualworld/interaction/campaign';
import { SaveSystem, advanceStory, initialStory } from '@virtualworld/interaction';
import { worldDemo } from '../fixtures/scenes';

function fixture() {
  const manifest = CampaignSchema.parse({
    version: 1,
    id: 'test-book',
    title: 'Book',
    description: '',
    chapters: [
      { id: 'first', title: 'First', directory: 'first' },
      { id: 'second', title: 'Second', directory: 'second', requires: ['first'] },
    ],
  });
  const scenes = manifest.chapters.map((chapter) => ({ ...worldDemo(), id: chapter.id }));
  const entries = new Map<string, string>();
  const storage = {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    },
  };
  return { manifest, scenes, storage };
}
function finish(scene: ReturnType<typeof worldDemo>, saves: SaveSystem) {
  let state = initialStory();
  // Replay the real dependency graph, including its final interaction.
  for (let pass = 0; pass < scene.nodes.length; pass++)
    for (const node of scene.nodes)
      if (
        node.interaction &&
        (node.interaction.requires || []).every((flag) => state.flags.includes(flag))
      )
        state = advanceStory(scene, state, node.id);
  expect(state.completed).toBe(true);
  saves.save(scene, state);
}
it('unlocks only completed reachable chapters, resumes selection, resets the entire campaign and invalidates edited stories', () => {
  const { manifest, scenes, storage } = fixture(),
    progress = new CampaignProgress(manifest, scenes, storage);
  expect(progress.current()).toBe('first');
  expect(() => progress.select('second')).toThrow(/locked/);
  finish(scenes[0], new SaveSystem(storage));
  expect(progress.status()[1].unlocked).toBe(true);
  progress.select('second');
  expect(new CampaignProgress(manifest, scenes, storage).current()).toBe('second');
  const changed = structuredClone(scenes);
  changed[0].tasks[0].label += ' revised';
  expect(new CampaignProgress(manifest, changed, storage).current()).toBe('first');
  progress.reset();
  expect(progress.status()[1].unlocked).toBe(false);
});
it('keeps chapters playable within a session when browser storage is denied', () => {
  const { manifest, scenes } = fixture();
  const denied = {
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('quota');
    },
    removeItem() {
      throw Error('denied');
    },
  };
  const progress = new CampaignProgress(manifest, scenes, denied);
  progress.reset();
  finish(scenes[0], new SaveSystem(denied));
  expect(progress.status()[1].unlocked).toBe(true);
  expect(() => progress.select('second')).not.toThrow();
  progress.reset();
});
it('retains saved chapter revisions across selection and reset, including edited story validation', () => {
  const { manifest, scenes, storage } = fixture();
  const progress = new CampaignProgress(manifest, scenes, storage);
  finish(scenes[0], new SaveSystem(storage));
  const edited = { ...scenes[0], name: 'Saved chapter', revision: 4 };
  progress.updateScene(edited);
  progress.select('second');
  expect(progress.select('first').revision).toBe(4);
  progress.reset();
  expect(progress.select('first').name).toBe('Saved chapter');
  expect(() => progress.updateScene({ ...edited, id: 'unknown' })).toThrow(/unknown/);
});
it('prefers session selection after quota failure and resets even when stored data cannot be removed', () => {
  const { manifest, scenes, storage } = fixture();
  const saves = new SaveSystem(storage),
    progress = new CampaignProgress(manifest, scenes, storage);
  progress.reset();
  finish(scenes[0], saves);
  progress.select('first');
  const readonlyStorage = {
    ...storage,
    setItem() {
      throw Error('quota');
    },
    removeItem() {
      throw Error('denied');
    },
  };
  const readonly = new CampaignProgress(manifest, scenes, readonlyStorage);
  readonly.select('second');
  expect(readonly.current()).toBe('second');
  readonly.reset();
  expect(readonly.status()[0].completed).toBe(false);
  expect(readonly.status()[1].unlocked).toBe(false);
});
