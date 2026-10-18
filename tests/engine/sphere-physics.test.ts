import { node, worldDemo } from '@virtualworld/scene-builder';
import { CharacterController } from '@virtualworld/interaction/character';
import { primitive } from '@virtualworld/engine/geometry';
import { it, expect } from 'vitest';
import * as THREE from 'three';
it('grounds, jumps and walks across both spherical poles with a radial capsule', async () => {
  const scene = worldDemo();
  scene.navigation = { kind: 'sphere', center: [0, 0, 0], radius: 6 };
  scene.spawn = [0, 6.1, 0];
  scene.nodes = [
    node('planet', 'Planet', 'sphere', [0, 0, 0], [12, 12, 12], '#fff', {
      collider: { shape: 'ball', size: [6, 6, 6] },
    }),
  ];
  const c = await CharacterController.create(
    scene,
    new Map([['planet', primitive(scene.nodes[0])]]),
  );
  try {
    for (let i = 0; i < 90; i++) c.step(1 / 60, scene.spawn);
    expect(c.object.position.length()).toBeGreaterThan(5.95);
    expect(c.object.position.length()).toBeLessThan(6.12);
    c.keys.add('Space');
    c.step(1 / 60, scene.spawn);
    expect(c.object.position.length()).toBeGreaterThan(6.07);
    c.keys.clear();
    for (let i = 0; i < 90; i++) c.step(1 / 60, scene.spawn);
    c.keys.add('KeyW');
    let minimumY = 6;
    for (let i = 0; i < 400; i++) {
      c.cameraForward.addScaledVector(c.up, -c.cameraForward.dot(c.up)).normalize();
      c.step(1 / 60, scene.spawn);
      expect(c.object.position.length()).toBeGreaterThan(5.9);
      minimumY = Math.min(minimumY, c.object.position.y);
    }
    expect(minimumY).toBeLessThan(-5.9);
    expect(c.object.position.length()).toBeLessThan(6.2);
    expect(c.up.dot(c.object.position.clone().normalize())).toBeGreaterThan(0.999);
  } finally {
    c.dispose();
  }
});
it('extracts triangle colliders after child and parent transforms', async () => {
  const scene = worldDemo();
  scene.spawn = [3, 4, 0];
  scene.nodes = [
    node('terrain', 'Terrain', 'glb', [3, 2, 0], [1, 1, 1], '#fff', {
      collider: { shape: 'mesh', size: [20, 1, 20] },
    }),
  ];
  const group = new THREE.Group();
  group.position.set(3, 2, 0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10));
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(2, 2, 2);
  group.add(mesh);
  const c = await CharacterController.create(scene, new Map([['terrain', group]]));
  try {
    for (let i = 0; i < 120; i++) c.step(1 / 60, scene.spawn);
    expect(c.object.position.y).toBeGreaterThan(1.95);
    expect(c.object.position.y).toBeLessThan(2.1);
  } finally {
    c.dispose();
    mesh.geometry.dispose();
  }
});
