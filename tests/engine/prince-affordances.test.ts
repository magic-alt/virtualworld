import { expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { worldDemo } from '../fixtures/scenes';
import * as story from '@virtualworld/interaction';
import { CharacterController } from '@virtualworld/interaction/character';
import { primitive } from '@virtualworld/engine/geometry';

it('classifies interactions from their grants and prerequisites without changing story progress', () => {
  const scene = worldDemo();
  const node = scene.nodes[0];
  const state = { flags: ['garden'], message: '', completed: false };
  const status = story.interactionStatus;
  expect(status).toBeTypeOf('function');
  expect(status({ ...node, interaction: undefined }, state)).toBe('none');
  expect(
    status({ ...node, interaction: { title: 'Rose', text: '', gives: 'garden' } }, state),
  ).toBe('completed');
  expect(
    status(
      { ...node, interaction: { title: 'Fox', text: '', gives: 'friend', requires: ['garden'] } },
      state,
    ),
  ).toBe('available');
  expect(
    status(
      { ...node, interaction: { title: 'Wheat', text: '', gives: 'wheat', requires: ['friend'] } },
      state,
    ),
  ).toBe('locked');
  expect(status({ ...node, interaction: { title: 'Read', text: '' } }, state)).toBe('available');
  expect(state.flags).toEqual(['garden']);
});

it.each([
  [1, 0, 0],
  [0, -1, 0],
] as const)('moves W along the ground-projected camera direction %j', async (...forward) => {
  const scene = worldDemo();
  scene.spawn = [0, 0, 0];
  const objects = new Map(
    scene.nodes.map((n) => {
      const object = primitive(n);
      object.position.fromArray(n.position);
      return [n.id, object] as const;
    }),
  );
  const character = await CharacterController.create(scene, objects);
  try {
    character.cameraForward.set(forward[0], forward[1], forward[2]);
    character.keys.add('KeyW');
    for (let i = 0; i < 20; i++) character.step(1 / 60, scene.spawn);
    expect(character.object.position.toArray().every(Number.isFinite)).toBe(true);
    expect(Math.hypot(character.object.position.x, character.object.position.z)).toBeGreaterThan(
      0.4,
    );
    if (forward[0]) {
      expect(character.object.position.x).toBeGreaterThan(0.4);
      expect(character.object.position.z).toBeCloseTo(0, 3);
    }
  } finally {
    character.dispose();
  }
});

it('places the B612 sunset interaction beside the real unmodified chair asset', () => {
  const bytes = readFileSync('assets/optimized/showcase/prince-b612.glb');
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const chair = doc.nodes.find((n: { name: string }) => n.name === 'Sunset chair seat slat');
  const scene = JSON.parse(readFileSync('worlds/little-prince/chapters/b612/scene.json', 'utf8'));
  const sunset = scene.nodes.find((n: { id: string }) => n.id === 'sunset');
  expect(
    new THREE.Vector3(...sunset.position).distanceTo(new THREE.Vector3(...chair.translation)),
  ).toBeLessThan(0.9);
});
