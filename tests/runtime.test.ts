import { it, expect } from 'vitest';
import { Object3D, Vector3, Box3 } from 'three';
import { node, worldDemo } from '../packages/scene/src/demos';
import { primitive } from '../packages/runtime/src/geometry';
import { captureTransform } from '../packages/runtime/src/transforms';
import { CharacterController } from '../packages/runtime/src/character';
it('captures edited transforms without baking explosion previews or joint values into the base pose', () => {
  const n = node('part', 'Part', 'box', [0, 1, 0], [1, 1, 1], '#ffffff', {
    explode: [2, 0, 0],
    joint: { axis: 'y', min: -1, max: 1, value: 0.5, confirmed: true },
  });
  const object = new Object3D();
  object.position.set(2.3, 1, 0);
  object.rotation.y = 0.7;
  const patch = captureTransform(n, object, 1);
  expect(patch.position?.[0]).toBeCloseTo(0.3);
  expect(patch.rotation?.[1]).toBeCloseTo(0.2);
});
it('bakes primitive dimensions into geometry rather than editable object scale', () => {
  const object = primitive(node('ball', 'Ball', 'sphere', [0, 0, 0], [2, 3, 4], '#ffffff'));
  expect(object.scale.toArray()).toEqual([1, 1, 1]);
  const size = new Box3().setFromObject(object).getSize(new Vector3());
  expect(size.toArray()).toEqual([2, 3, 4]);
});
it('uses actual Rapier collision to stop at a wall and land on the floor', async () => {
  const scene = worldDemo();
  scene.spawn = [0, 1, 0];
  scene.nodes = [
    node('ground', 'Ground', 'box', [0, -0.5, 0], [20, 1, 20], '#ffffff', {
      collider: { shape: 'box', size: [20, 1, 20] },
    }),
    node('wall', 'Wall', 'box', [0, 1, -2], [10, 2, 0.2], '#ffffff', {
      collider: { shape: 'box', size: [10, 2, 0.2] },
    }),
  ];
  const objects = new Map(
    scene.nodes.map((n) => {
      const object = primitive(n);
      object.position.fromArray(n.position);
      return [n.id, object];
    }),
  );
  const character = await CharacterController.create(scene, objects);
  try {
    character.keys.add('KeyW');
    for (let i = 0; i < 120; i++) character.step(1 / 60, scene.spawn);
    expect(character.object.position.z).toBeGreaterThan(-1.7);
    expect(character.object.position.z).toBeLessThan(-1.3);
    expect(character.object.position.y).toBeGreaterThan(-0.05);
    expect(character.object.position.y).toBeLessThan(0.1);
    character.keys.clear();
    character.keys.add('Space');
    character.step(1 / 60, scene.spawn);
    expect(character.object.position.y).toBeGreaterThan(0.05);
  } finally {
    character.dispose();
  }
});
