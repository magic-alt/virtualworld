import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterController } from '@virtualworld/interaction/character';
import { readWorld } from '@virtualworld/scene-builder/io';

async function landscape() {
  const data = readFileSync('assets/optimized/showcase/prince-desert.glb');
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'headless-images',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  const gltf = await loader.parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    '',
  );
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    }
  });
}

describe('desert encounter authored scene', () => {
  it('extends real ground to 220 metres without scaling the aircraft', async () => {
    const root = await landscape();
    const scene = await readWorld('worlds/little-prince/chapters/desert');
    expect(scene.navigation).toMatchObject({
      kind: 'plane',
      bounds: { min: [-100, -100], max: [100, 100] },
    });
    try {
      const bounds = new THREE.Box3().setFromObject(root);
      expect(bounds.min.x).toBeCloseTo(-110);
      expect(bounds.max.x).toBeCloseTo(110);
      expect(bounds.min.z).toBeCloseTo(-110);
      expect(bounds.max.z).toBeCloseTo(110);
      const plane = root.getObjectByName('Tapered_vintage_fuselage')!;
      expect(plane).toBeDefined();
      const size = new THREE.Box3().setFromObject(plane).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(5.6074, 3);
      expect(size.z).toBeCloseTo(3.45, 3);
      const ray = new THREE.Raycaster();
      for (const sign of [-1, 1])
        for (const distance of [10.98, 11, 11.02, 30, 75, 100, 109]) {
          for (const [x, z] of [
            [sign * distance, 0],
            [0, sign * distance],
            [sign * distance, sign * distance],
          ]) {
            ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
            const hit = ray.intersectObject(root, true)[0];
            expect(hit, `No terrain at ${x}, ${z}`).toBeDefined();
            expect(hit.point.y).toBeGreaterThan(-3);
            expect(hit.point.y).toBeLessThan(3);
          }
        }
    } finally {
      dispose(root);
    }
  });

  it('joins every original perimeter vertex with identical geometry and texture attributes', async () => {
    const root = await landscape();
    try {
      const ground = root.getObjectByName('Sculpted_dunes') as THREE.Mesh;
      const horizon = root.getObjectByName('Desert_horizon') as THREE.Mesh;
      expect(horizon).toBeDefined();
      const source = ground.geometry.getAttribute('position');
      const perimeter = new Map<string, number>();
      for (let i = 0; i < source.count; i++) {
        if (Math.abs(source.getX(i)) === 11 || Math.abs(source.getZ(i)) === 11)
          perimeter.set(`${source.getX(i)},${source.getZ(i)}`, i);
      }
      expect(perimeter.size).toBe(512);
      const positions = horizon.geometry.getAttribute('position');
      let matched = 0;
      for (let i = 0; i < positions.count; i++) {
        if (Math.max(Math.abs(positions.getX(i)), Math.abs(positions.getZ(i))) !== 11) continue;
        const index = perimeter.get(`${positions.getX(i)},${positions.getZ(i)}`);
        expect(index).toBeDefined();
        for (const name of ['position', 'normal', 'uv', 'tangent']) {
          const actual = horizon.geometry.getAttribute(name),
            expected = ground.geometry.getAttribute(name);
          for (let axis = 0; axis < actual.itemSize; axis++)
            expect(actual.array[i * actual.itemSize + axis], `${name} at seam vertex ${i}`).toBe(
              expected.array[index! * expected.itemSize + axis],
            );
        }
        matched++;
      }
      expect(matched).toBe(512);
      const tangents = horizon.geometry.getAttribute('tangent');
      for (let i = 512; i < tangents.count; i++)
        expect(tangents.getW(i), `Normal-map handedness at horizon vertex ${i}`).toBe(
          tangents.getW(i % 512),
        );
    } finally {
      dispose(root);
    }
  });

  it.each(['east', 'west', 'north', 'south'])(
    'walks from spawn across the old %s edge to the new boundary on actual triangle colliders',
    async (direction) => {
      const root = await landscape();
      const scene = await readWorld('worlds/little-prince/chapters/desert');
      const character = await CharacterController.create(
        scene,
        new Map([['landscape', root]]),
        new THREE.Group(),
        scene.actor!.height,
      );
      try {
        for (let i = 0; i < 60; i++) character.step(1 / 60, scene.spawn);
        character.keys.add(
          { east: 'KeyD', west: 'KeyA', north: 'KeyW', south: 'KeyS' }[direction]!,
        );
        let previous = character.object.position.clone();
        for (let i = 0; i < 2200; i++) {
          character.step(1 / 60, scene.spawn);
          expect(character.object.position.y).toBeGreaterThan(-3);
          expect(
            Math.hypot(
              character.object.position.x - previous.x,
              character.object.position.z - previous.z,
            ),
          ).toBeLessThan(0.1);
          previous.copy(character.object.position);
        }
        const position = character.object.position;
        expect(
          direction === 'east'
            ? position.x
            : direction === 'west'
              ? -position.x
              : direction === 'north'
                ? -position.z
                : position.z,
        ).toBeGreaterThan(99.5);
        expect(Math.abs(position.x) + character.collider.radius()).toBeLessThanOrEqual(100);
        expect(Math.abs(position.z) + character.collider.radius()).toBeLessThanOrEqual(100);
        expect(character.controller.computedGrounded()).toBe(true);
      } finally {
        character.dispose();
        dispose(root);
      }
    },
  );
});
