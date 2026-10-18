import { expect, it } from 'vitest';
import { SaveSystem, advanceStory, initialStory } from '@virtualworld/interaction';
import { worldDemo } from '../fixtures/scenes';

function memory() {
  const entries = new Map<string, string>();
  return {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    },
    entries,
  };
}
it('resumes/reset progress without mutating SceneSpec; scopes progress by story and world', () => {
  const storage = memory(),
    saves = new SaveSystem(storage),
    scene = worldDemo();
  const original = JSON.stringify(scene);
  const state = advanceStory(scene, initialStory(), 'keeper');
  saves.save(scene, state);
  expect(new SaveSystem(storage).load(scene)).toEqual(state);
  expect(saves.load({ ...scene, id: 'other' }).flags).toEqual([]);
  const changed = structuredClone(scene);
  changed.nodes.find((n) => n.id === 'keeper')!.interaction!.text += ' Changed';
  expect(saves.load(changed).flags).toEqual([]);
  saves.reset(scene);
  expect(saves.load(scene)).toEqual(initialStory());
  expect(JSON.stringify(scene)).toBe(original);
});
it('recovers from invalid/forged saves and unavailable browser storage', () => {
  const storage = memory(),
    saves = new SaveSystem(storage),
    scene = worldDemo();
  saves.save(scene, initialStory());
  const key = [...storage.entries.keys()][0];
  storage.entries.set(key, '{broken');
  expect(saves.load(scene)).toEqual(initialStory());
  storage.entries.set(
    key,
    JSON.stringify({
      version: 1,
      state: { flags: ['sent-letter'], completed: true, message: 'forged' },
    }),
  );
  expect(saves.load(scene)).toEqual(initialStory());
  const unavailable = new SaveSystem({
    getItem() {
      throw Error('denied');
    },
    setItem() {
      throw Error('quota');
    },
    removeItem() {
      throw Error('denied');
    },
  });
  expect(() => unavailable.save(scene, initialStory())).not.toThrow();
  expect(unavailable.load(scene)).toEqual(initialStory());
});
