import { expect, it } from 'vitest';
import { readWorld } from '@virtualworld/scene-builder/io';

it('casts one playable Prince and a pilot NPC beside the encounter hotspot', async () => {
  const scene = await readWorld('worlds/little-prince/chapters/desert');
  expect(scene.actor).toMatchObject({ assetId: 'prince-character', nodeId: 'prince' });
  const prince = scene.nodes.find((node) => node.id === 'prince')!;
  expect(prince.position).toEqual(scene.spawn);
  expect(scene.nodes.filter((node) => node.assetId === 'prince-character')).toHaveLength(1);
  const pilot = scene.nodes.find((node) => node.assetId === 'prince-pilot')!;
  expect(pilot).toBeDefined();
  expect(pilot.visible).toBe(true);
  const meeting = scene.nodes.find((node) => node.id === 'meeting')!;
  expect(
    Math.hypot(pilot.position[0] - meeting.position[0], pilot.position[2] - meeting.position[2]),
  ).toBeLessThan(0.5);
});
