import { expect, it } from 'vitest';
import { worldDemo } from '../fixtures/scenes';
import { CharacterController } from '@virtualworld/interaction/character';
import { primitive } from '@virtualworld/engine/geometry';

it('moves a real physical character with touch input and stops on input release', async () => {
  const scene = worldDemo();
  scene.spawn = [0, 0, 0];
  const objects = new Map(
    scene.nodes.map((n) => {
      const o = primitive(n);
      o.position.fromArray(n.position);
      return [n.id, o];
    }),
  );
  const character = await CharacterController.create(scene, objects);
  try {
    character.movement = { x: 0, y: -1, jump: false };
    for (let i = 0; i < 20; i++) character.step(1 / 60, scene.spawn);
    expect(character.object.position.z).toBeLessThan(-0.4);
    character.movement = { x: 0, y: 0, jump: false };
    const z = character.object.position.z;
    for (let i = 0; i < 20; i++) character.step(1 / 60, scene.spawn);
    expect(character.object.position.z).toBeCloseTo(z, 3);
  } finally {
    character.dispose();
  }
});
