import { it, expect } from 'vitest';
import { harmonicState } from '../../packages/engine/src/mechanism';
it('couples input and flex at the real tooth ratio with relative morph phase', () => {
  const s = harmonicState(Math.PI * 2, 6, 200, 202);
  expect(s.outputAngle).toBeCloseTo((-Math.PI * 2) / 100);
  expect(s.outputRpm).toBeCloseTo(-0.06);
  expect(s.cos).toBeCloseTo(Math.cos(2 * (s.inputAngle - s.outputAngle)));
});
import { StudioRuntime } from '../../packages/engine/src/runtime';
import { node } from '@virtualworld/scene-builder';
import { worldDemo } from '../fixtures/scenes';
import * as THREE from 'three';
it('keeps fixed parts and authored rotations stable while explosion and section are transient', () => {
  const spec = worldDemo();
  spec.nodes = ['wave', 'flex', 'output', 'fixed', 'full', 'section'].map((id) =>
    node(id, id, 'box', [0, 0.1, 0], [1, 1, 1], '#fff', {
      rotation: [0.1, 0.2, 0.3],
      explode: [0, 0.1, 0],
      visible: id !== 'section',
    }),
  );
  spec.mechanism = {
    kind: 'harmonic',
    waveNodeId: 'wave',
    flexNodeId: 'flex',
    outputNodeId: 'output',
    fixedNodeIds: ['fixed'],
    flexTeeth: 200,
    ringTeeth: 202,
    cosMorph: 'WaveCos',
    sinMorph: 'WaveSin',
    fullHousingIds: ['full'],
    sectionHousingIds: ['section'],
    dimensions: {
      baseDiameter: 0.215,
      housingDiameter: 0.18,
      totalHeight: 0.165,
      boreDiameter: 0.02,
    },
  };
  const r = Object.create(StudioRuntime.prototype) as StudioRuntime;
  Object.assign(r, { spec, objects: new Map(), inputAngle: 2, inputRpm: 6, section: false });
  for (const n of spec.nodes) {
    const o = new THREE.Group();
    o.rotation.set(...n.rotation);
    r.objects.set(n.id, o);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = { WaveCos: 0, WaveSin: 1 };
  mesh.morphTargetInfluences = [0, 0];
  r.objects.get('flex')!.add(mesh);
  const saved = JSON.stringify(spec);
  r.explode(1);
  (r as any).applyMechanism(true);
  expect(r.objects.get('fixed')!.rotation.y).toBeCloseTo(0.2);
  expect(r.objects.get('output')!.rotation.y).toBeCloseTo(0.18);
  expect(r.objects.get('wave')!.position.y).toBeCloseTo(0.2);
  expect(mesh.morphTargetInfluences[0]).toBeCloseTo(Math.cos(4.04));
  r.setSection(true);
  expect(r.objects.get('full')!.visible).toBe(false);
  expect(r.objects.get('section')!.visible).toBe(true);
  r.isolate('fixed');
  expect(r.objects.get('section')!.visible).toBe(false);
  r.isolate();
  expect(r.objects.get('section')!.visible).toBe(true);
  r.animateJoints(false);
  r.explode(0);
  expect(mesh.morphTargetInfluences![0]).toBeCloseTo(Math.cos(4.04));
  expect(r.objects.get('wave')!.rotation.y).toBeCloseTo(2.2);
  expect(r.objects.get('wave')!.position.y).toBeCloseTo(0.1);
  expect(JSON.stringify(spec)).toBe(saved);
});
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
it('loads authored harmonic GLB morphs into actual Three instances', async () => {
  const buffer = readFileSync(
    new URL('../../assets/optimized/showcase/harmonic-joint.glb', import.meta.url),
  );
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'headless-textures',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  const gltf = await loader.parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
  const morphs: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.morphTargetDictionary?.WaveCos !== undefined) morphs.push(o);
  });
  expect(morphs.length).toBeGreaterThan(0);
  for (const mesh of morphs) {
    expect(mesh.morphTargetDictionary?.WaveSin).toBeDefined();
    expect(mesh.geometry.morphAttributes.position).toHaveLength(2);
    expect(mesh.geometry.morphTargetsRelative).toBe(true);
  }
  const bounds = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  expect(bounds.x).toBeCloseTo(0.10024, 5);
  expect(bounds.y).toBeCloseTo(0.088111111, 5);
});
