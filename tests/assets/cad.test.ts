import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { cadToGroup } from '@virtualworld/asset-runtime';
const require = createRequire(import.meta.url);
it('imports a real STEP cube into metre geometry and retains named hierarchy', async () => {
  const occt = await require('occt-import-js')();
  const bytes = await readFile('public/fixtures/cube-mm.step');
  const result = occt.ReadStepFile(bytes, { linearUnit: 'meter' });
  const group = cadToGroup(result);
  const size = new Box3().setFromObject(group).getSize(new Vector3());
  expect(size.x).toBeCloseTo(0.01, 5);
  expect(size.y).toBeCloseTo(0.01, 5);
  expect(size.z).toBeCloseTo(0.01, 5);
  expect(group.children.length).toBeGreaterThan(0);
  expect(group.children[0].name.length).toBeGreaterThan(0);
});
it('rejects a malformed CAD result instead of creating an empty successful scene', () =>
  expect(() =>
    cadToGroup({ success: false, root: { name: '', children: [], meshes: [] }, meshes: [] }),
  ).toThrow());
it('preserves separate named parts when reading a real STEP assembly', async () => {
  const occt = await require('occt-import-js')();
  const result = occt.ReadStepFile(await readFile('public/fixtures/assembly.step'), {
    linearUnit: 'meter',
  });
  const group = cadToGroup(result);
  let meshes = 0;
  group.traverse((o) => {
    if ((o as any).isMesh) {
      expect(o.name.length).toBeGreaterThan(0);
      meshes++;
    }
  });
  expect(meshes).toBeGreaterThan(1);
  expect(group.children.length).toBeGreaterThan(0);
});
it('batches opaque CAD faces by color while keeping every triangle and its face color', () => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < 8; i++) {
    positions.push(i, 0, 0, i + 0.8, 0, 0, i, 0.8, 0);
    indices.push(i * 3, i * 3 + 1, i * 3 + 2);
  }
  const group = cadToGroup({
    success: true,
    root: { name: 'assembly', meshes: [0], children: [] },
    meshes: [
      {
        name: 'colored part',
        color: [0.5, 0.5, 0.5],
        attributes: { position: { array: positions } },
        index: { array: indices },
        brep_faces: Array.from({ length: 6 }, (_, j) => ({
          first: j + 1,
          last: j + 1,
          color: (j + 1) % 2 ? [1, 0, 0] : [0, 0, 1],
        })),
      },
    ],
  });
  const mesh = group.children[0] as import('three').Mesh;
  const materials = mesh.material as import('three').MeshStandardMaterial[];
  expect(group.name).toBe('assembly');
  expect(mesh.name).toBe('colored part');
  expect(mesh.geometry.groups.length).toBeLessThanOrEqual(3);
  expect(materials).toHaveLength(3);
  const seen: number[] = [];
  for (const range of mesh.geometry.groups) {
    for (let at = range.start; at < range.start + range.count; at += 3) {
      const ids = [0, 1, 2].map((j) => mesh.geometry.index!.getX(at + j));
      const triangle = Math.round(mesh.geometry.attributes.position.getX(ids[0]));
      expect(ids).toEqual([triangle * 3, triangle * 3 + 1, triangle * 3 + 2]);
      expect(materials[range.materialIndex!].color.getHexString()).toBe(
        triangle === 0 || triangle === 7 ? '808080' : triangle % 2 ? 'ff0000' : '0000ff',
      );
      seen.push(triangle);
    }
  }
  expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});
