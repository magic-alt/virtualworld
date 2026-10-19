import { expect, it } from 'vitest';
import * as THREE from 'three';
import { StudioRuntime } from '@virtualworld/engine';
import { readWorld } from '@virtualworld/scene-builder/io';
import { initialStory } from '@virtualworld/interaction';

async function earth(flags: string[], position: [number, number, number]) {
  const spec = await readWorld('worlds/little-prince/chapters/earth');
  const objects = new Map(
    spec.nodes.map((node) => {
      const object = new THREE.Group();
      object.position.fromArray(node.position);
      object.visible = node.visible;
      object.updateMatrixWorld(true);
      return [node.id, object] as const;
    }),
  );
  const actor = new THREE.Group();
  actor.position.fromArray(position);
  const runtime = Object.create(StudioRuntime.prototype) as StudioRuntime;
  Object.assign(runtime, {
    spec,
    objects,
    char: { object: actor },
    story: { ...initialStory(), flags },
  });
  return runtime;
}

it('selects the final reflection when returning to the already visited rose garden', async () => {
  const runtime = await earth(['garden', 'friend', 'wheat'], [-1.6, 0, -1]);
  expect(runtime.nearest()?.id).toBe('reflection');
});

it('chooses an available task before a closer task with unmet prerequisites', async () => {
  const runtime = await earth(['garden'], [3, 0, -2]);
  expect(runtime.nearest()?.id).toBe('friend');
});

it('does not interact with story anchors hidden by an ancestor', async () => {
  const runtime = await earth([], [-1.6, 0, -1]);
  const hidden = new THREE.Group();
  hidden.visible = false;
  for (const object of runtime.objects.values()) hidden.add(object);
  hidden.updateMatrixWorld(true);
  expect(runtime.nearest()).toBeUndefined();
});

it('keeps the interaction range even when the remaining task is available', async () => {
  const runtime = await earth(['garden', 'friend', 'wheat'], [20, 0, 20]);
  expect(runtime.nearest()).toBeUndefined();
});
