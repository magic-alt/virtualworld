import { expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { optimizeGlb } from '@virtualworld/scene-builder/pipeline';
import { recordUpload } from '@virtualworld/scene-builder/asset-library';
import { validateWorldAssets } from '../../generators/scene-builder/src/validate';
import { industrialDemo } from '../fixtures/scenes';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
export async function triangleGlb() {
  const d = new Document(),
    buffer = d.createBuffer();
  const positions = d
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const primitive = d.createPrimitive().setAttribute('POSITION', positions);
  const material = d.createMaterial().setDoubleSided(true);
  primitive.setMaterial(material);
  const mesh = d.createMesh('Triangle').addPrimitive(primitive);
  d.createScene().addChild(d.createNode('Triangle').setMesh(mesh));
  return new NodeIO().writeBinary(d);
}
it('optimizes and validates a self-contained GLB with traceable byte hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-pipeline-'));
  roots.push(root);
  const source = await triangleGlb(),
    out = join(root, 'mesh.glb');
  const result = await optimizeGlb(source, out);
  expect(result.validation.errors).toBe(0);
  expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.outputSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.outputBytes).toBe((await readFile(out)).length);
  expect(result.tools.validator).toBeTruthy();
});
it('rejects invalid assets before publishing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-pipeline-'));
  roots.push(root);
  const out = join(root, 'mesh.glb');
  await expect(optimizeGlb(new Uint8Array([1, 2, 3]), out)).rejects.toThrow();
  await expect(readFile(out)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('validates imported assets from the new library layout as well as legacy data paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-pipeline-'));
  roots.push(root);
  const upload = await recordUpload(
    join(root, 'assets'),
    Buffer.from(await triangleGlb()),
    'triangle.glb',
  );
  const scene = industrialDemo();
  scene.assets.push({
    id: upload.manifest.id,
    name: 'Triangle',
    type: 'glb',
    url: `/api/assets/${upload.filename}`,
    bytes: upload.manifest.bytes,
  });
  await expect(validateWorldAssets(scene, root)).resolves.toEqual({ valid: true });
});
it('preserves supported material extensions during optimization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-pipeline-'));
  roots.push(root);
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
  const doc = await io.readBinary(await triangleGlb());
  doc
    .getRoot()
    .listMaterials()[0]
    .setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  const output = join(root, 'unlit.glb');
  await optimizeGlb(await io.writeBinary(doc), output);
  const processed = await io.read(output);
  expect(processed.getRoot().listMaterials()[0].getExtension('KHR_materials_unlit')).toBeTruthy();
});
