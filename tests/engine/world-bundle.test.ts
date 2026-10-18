import { expect, it } from 'vitest';
import { assembleWorld, splitWorld } from '../../generators/scene-builder/src/index';
import { worldDemo } from '../fixtures/scenes';
import { industrialDemo } from '../fixtures/scenes';

it('compiles both split demo bundles without losing runtime content', () => {
  for (const scene of [worldDemo(), industrialDemo()]) {
    const bundle = splitWorld(scene);
    expect(assembleWorld(bundle.scene, bundle.story, bundle.assets)).toEqual(scene);
    expect(bundle.scene).not.toHaveProperty('assets');
    expect(bundle.scene.nodes.every((n) => !('interaction' in n))).toBe(true);
  }
});
it('rejects world identity mismatch and dangling story references', () => {
  const bundle = splitWorld(worldDemo());
  expect(() =>
    assembleWorld(bundle.scene, { ...bundle.story, worldId: 'other' }, bundle.assets),
  ).toThrow();
  bundle.story.interactions['missing-node'] = { title: 'Broken', text: 'Dangling' };
  expect(() => assembleWorld(bundle.scene, bundle.story, bundle.assets)).toThrow(/missing-node/);
});
