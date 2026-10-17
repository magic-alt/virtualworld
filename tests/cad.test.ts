import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { cadToGroup } from '../apps/studio/src/cad';
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
