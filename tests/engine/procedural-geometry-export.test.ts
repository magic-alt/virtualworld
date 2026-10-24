import { expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { proceduralModel } from '../../generators/scene-builder/src/engine-export/assets';
import { validateGlb } from '../../generators/scene-builder/src/pipeline';

it('exports many CAD-style surface groups without multiplying the full vertex buffer per face', async () => {
  const geometry = new PlaneGeometry(1, 1, 64, 64);
  geometry.clearGroups();
  const indices = Array.from(geometry.index!.array);
  const trianglesPerGroup = 32;
  for (let start = 0; start < indices.length; start += trianglesPerGroup * 3)
    geometry.addGroup(start, trianglesPerGroup * 3, (start / (trianglesPerGroup * 3)) % 2);
  const mesh = new Mesh(geometry, [
    new MeshStandardMaterial({ color: '#ff0000' }),
    new MeshStandardMaterial({ color: '#0000ff' }),
  ]);
  mesh.name = 'multi-face CAD part';
  const bytes = await proceduralModel(mesh);
  // About 200 KB of unique vertex/index data plus JSON: not 34 MB of repeated arrays.
  expect(bytes.byteLength).toBeLessThan(1_000_000);
  expect((await validateGlb(bytes)).errors).toBe(0);
  const document = await new NodeIO().readBinary(bytes);
  const primitives = document.getRoot().listMeshes()[0].listPrimitives();
  expect(primitives).toHaveLength(256);
  expect(primitives.flatMap((p) => Array.from(p.getIndices()!.getArray()!))).toEqual(indices);
  for (const [i, primitive] of primitives.entries()) {
    const positions = primitive.getAttribute('POSITION')!;
    expect(positions.getCount()).toBe(65 * 65);
    expect(positions.getMin([])).toEqual([-0.5, -0.5, 0]);
    expect(positions.getMax([])).toEqual([0.5, 0.5, 0]);
    expect(primitive.getMaterial()!.getBaseColorFactor()).toEqual(
      i % 2 ? [0, 0, 1, 1] : [1, 0, 0, 1],
    );
  }
});
