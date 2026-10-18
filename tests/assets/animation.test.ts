import { it, expect } from 'vitest';
import * as THREE from 'three';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import { node } from '@virtualworld/scene-schema';
it('releases each shared skeleton bone texture exactly once without touching another actor', () => {
  const root = new THREE.Group(),
    skeleton = new THREE.Skeleton([new THREE.Bone()]),
    other = new THREE.Skeleton([new THREE.Bone()]);
  skeleton.computeBoneTexture();
  other.computeBoneTexture();
  let disposed = 0,
    otherDisposed = 0;
  skeleton.boneTexture!.addEventListener('dispose', () => {
    disposed++;
  });
  other.boneTexture!.addEventListener('dispose', () => {
    otherDisposed++;
  });
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.bind(skeleton);
    root.add(mesh);
  }
  disposeObject(root);
  expect(disposed).toBe(1);
  expect(otherDisposed).toBe(0);
  other.dispose();
});
it('retains real clips and gives cloned actors independent animation state', async () => {
  const root = new THREE.Group();
  const bone = new THREE.Object3D();
  bone.name = 'hips';
  root.add(bone);
  root.animations = [
    new THREE.AnimationClip('Walk', 1, [
      new THREE.NumberKeyframeTrack('hips.position[x]', [0, 1], [0, 1]),
    ]),
  ];
  const registry = new AssetRegistry(async () => root);
  const asset = { id: 'actor', name: 'Actor', type: 'glb' as const, url: 'actor.glb', bytes: 0 };
  const n = node('actor', 'Actor', 'glb', [0, 0, 0], [1, 1, 1], '#fff');
  const a = await registry.loadInstance(asset, n),
    b = await registry.loadInstance(asset, n);
  expect(a.animations[0]).not.toBe(b.animations[0]);
  const ma = new THREE.AnimationMixer(a),
    mb = new THREE.AnimationMixer(b);
  ma.clipAction(a.animations[0]).play();
  mb.clipAction(b.animations[0]).play();
  ma.update(0.5);
  mb.update(0.2);
  expect(a.children[0].position.x).toBeCloseTo(0.5);
  expect(b.children[0].position.x).toBeCloseTo(0.2);
  ma.stopAllAction();
  ma.uncacheRoot(a);
  disposeObject(a);
  mb.update(0.1);
  expect(b.children[0].position.x).toBeCloseTo(0.3);
  mb.stopAllAction();
  mb.uncacheRoot(b);
  disposeObject(b);
  registry.dispose();
});
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
it('plays actual Blender skin clips independently after cloning', async () => {
  const data = readFileSync(
    new URL('../../assets/optimized/showcase/prince-character.glb', import.meta.url),
  );
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'headless-images',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  const gltf = await loader.parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    '',
  );
  gltf.scene.animations = gltf.animations;
  expect(gltf.animations.map((c) => c.name)).toEqual(
    expect.arrayContaining(['Idle', 'Walk', 'Interact']),
  );
  const registry = new AssetRegistry(async () => gltf.scene),
    asset = {
      id: 'prince',
      name: 'Prince',
      type: 'glb' as const,
      url: 'prince.glb',
      bytes: data.length,
    },
    n = node('prince', 'Prince', 'glb', [0, 0, 0], [1, 1, 1], '#fff');
  const a = await registry.loadInstance(asset, n),
    b = await registry.loadInstance(asset, n);
  const bonesA: THREE.Bone[] = [],
    bonesB: THREE.Bone[] = [];
  a.traverse((o) => {
    if (o instanceof THREE.Bone) bonesA.push(o);
  });
  b.traverse((o) => {
    if (o instanceof THREE.Bone) bonesB.push(o);
  });
  expect(bonesA.length).toBeGreaterThan(0);
  expect(bonesA[0]).not.toBe(bonesB[0]);
  const mixer = new THREE.AnimationMixer(a);
  mixer.clipAction(THREE.AnimationClip.findByName(a.animations, 'Walk')!).play();
  mixer.update(0.25);
  expect(bonesA.some((bone, i) => bone.quaternion.angleTo(bonesB[i].quaternion) > 0.01)).toBe(true);
  mixer.stopAllAction();
  mixer.uncacheRoot(a);
  disposeObject(a);
  disposeObject(b);
  registry.dispose();
});
