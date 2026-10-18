import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateScene } from '@virtualworld/scene-schema';

const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const gltf = (name: string) => {
  const bytes = readFileSync(`assets/optimized/showcase/prince-${name}.glb`);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  return { bytes, doc: JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) };
};
describe('Little Prince offline authored campaign', () => {
  it('keeps the three chapters sequential and every task locally reachable', () => {
    const campaign = load('worlds/little-prince/campaign.json');
    expect(campaign.chapters.map((c: { id: string }) => c.id)).toEqual([
      'little-prince-desert',
      'little-prince-b612',
      'little-prince-earth',
    ]);
    for (const chapter of campaign.chapters) {
      const dir = path.join('worlds/little-prince', chapter.directory);
      const scene = load(path.join(dir, 'scene.json'));
      const story = load(path.join(dir, 'story.json'));
      const assets = load(path.join(dir, 'assets.json'));
      expect(
        validateScene({
          ...scene,
          assets: assets.assets,
          tasks: story.tasks,
          nodes: scene.nodes.map((n: { id: string }) => ({
            ...n,
            ...(story.interactions[n.id] ? { interaction: story.interactions[n.id] } : {}),
          })),
        }),
      ).toEqual([]);
      expect(scene.nodes.some((n: { id: string }) => /portal/i.test(n.id))).toBe(false);
      const interactions = Object.values(story.interactions) as {
        gives: string;
        requires?: string[];
        completes?: boolean;
      }[];
      expect(interactions.filter((i) => i.completes)).toHaveLength(1);
      const final = interactions.find((i) => i.completes)!;
      expect(final.gives).toBe(story.tasks.at(-1).flag);
      const required = new Set<string>();
      const visit = (flag: string) => {
        if (required.has(flag)) return;
        required.add(flag);
        for (const dependency of interactions.find((i) => i.gives === flag)?.requires || [])
          visit(dependency);
      };
      visit(final.gives);
      expect([...required].sort()).toEqual(story.tasks.map((t: { flag: string }) => t.flag).sort());
      if (scene.navigation.kind === 'sphere')
        expect(scene.nodes[0].collider.size).toEqual([6, 6, 6]);
      if (scene.navigation.kind === 'sphere')
        expect(
          scene.nodes.filter((n: { id: string }) => n.id.startsWith('volcano-collider-')),
        ).toHaveLength(3);
    }
    const earth = load('worlds/little-prince/chapters/earth/story.json');
    expect(earth.interactions.reflection.requires).toEqual(['wheat']);
    expect(earth.interactions.friend.requires).toEqual(['garden']);
  });
  it.each(['character', 'pilot'])('%s is a rigged actor with three real in-place clips', (name) => {
    const { doc, bytes } = gltf(name);
    expect(doc.skins.length).toBeGreaterThan(0);
    expect(doc.animations.map((a: { name: string }) => a.name).sort()).toEqual([
      'Idle',
      'Interact',
      'Walk',
    ]);
    // Blender samples bind-pose translations too. They must stay constant,
    // rather than being absent, for an in-place clip.
    const binaryOffset = 28 + bytes.readUInt32LE(12);
    for (const animation of doc.animations)
      for (const channel of animation.channels) {
        if (channel.target.path !== 'translation') continue;
        const accessor = doc.accessors[animation.samplers[channel.sampler].output];
        const view = doc.bufferViews[accessor.bufferView];
        const base = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
        for (let i = 1; i < accessor.count; i++)
          for (let axis = 0; axis < 3; axis++)
            expect(
              Math.abs(
                bytes.readFloatLE(base + i * (view.byteStride || 12) + axis * 4) -
                  bytes.readFloatLE(base + axis * 4),
              ),
            ).toBeLessThan(0.00001);
      }
  });
  it.each(['character', 'pilot', 'fox', 'desert', 'b612', 'earth'])(
    '%s has a verified receipt and embedded textures',
    (name) => {
      const { bytes, doc } = gltf(name);
      const receipt = load(`assets/manifests/showcase/prince-${name}.json`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
      expect(doc.images.length).toBeGreaterThan(0);
      expect(
        doc.images.every(
          (i: { bufferView?: number; uri?: string }) => i.bufferView !== undefined && !i.uri,
        ),
      ).toBe(true);
      expect(bytes.length).toBeLessThan(15 * 1024 * 1024);
      expect(receipt.triangles).toBeGreaterThan(1000);
      expect(receipt.triangles).toBeLessThan(750000);
      expect(receipt.validator.errors).toBe(0);
      expect(receipt.validator.warnings).toBe(0);
      if (name === 'fox')
        expect(doc.animations.map((a: { name: string }) => a.name)).toEqual(['Idle']);
    },
  );
});
