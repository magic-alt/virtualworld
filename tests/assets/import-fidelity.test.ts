import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { groupCommands } from '@virtualworld/scene-builder';
import { applyCommands, emptyScene } from '@virtualworld/scene-schema';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import { recordUpload } from '@virtualworld/scene-builder/asset-library';
import { importFile } from '../../apps/web/src/import';
import { validTriangleGlb } from '../fixtures/glb';
const asset = {
  id: 'imported',
  name: 'Imported',
  type: 'glb' as const,
  url: 'assets/imported.glb',
  bytes: 0,
};
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function imported(group: THREE.Object3D) {
  return applyCommands(emptyScene(), 0, groupCommands(group, asset, 'Imported'));
}
it('retains a real imported skin and clips with independent skeleton ownership', async () => {
  const data = await readFile(
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
  gltf.scene.position.set(2, 3, 4);
  const scene = imported(gltf.scene);
  expect(scene.nodes).toHaveLength(1);
  const spec = scene.nodes[0];
  expect(spec.assetNode).toBeUndefined();
  expect(spec.position).toEqual([0, 0, 0]);
  expect(spec.animation?.clip).toBe(gltf.animations[0].name);
  const registry = new AssetRegistry(async () => gltf.scene);
  const a = await registry.loadInstance(asset, spec),
    b = await registry.loadInstance(asset, spec);
  const skins = (root: THREE.Object3D) => {
    const result: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) result.push(o);
    });
    return result;
  };
  expect(a.position.toArray()).toEqual([2, 3, 4]);
  expect(skins(a)[0].skeleton).not.toBe(skins(b)[0].skeleton);
  const bonesB = skins(b)[0].skeleton.bones.map((bone) => bone.quaternion.clone());
  const mixer = new THREE.AnimationMixer(a);
  mixer.clipAction(THREE.AnimationClip.findByName(a.animations, 'Walk')!).play();
  mixer.update(0.25);
  expect(
    skins(a)[0].skeleton.bones.some((bone, i) => bone.quaternion.angleTo(bonesB[i]) > 0.01),
  ).toBe(true);
  expect(skins(b)[0].skeleton.bones.every((bone, i) => bone.quaternion.equals(bonesB[i]))).toBe(
    true,
  );
  skins(b)[0].skeleton.computeBoneTexture();
  let releasedB = 0;
  skins(b)[0].skeleton.boneTexture!.addEventListener('dispose', () => releasedB++);
  mixer.stopAllAction();
  mixer.uncacheRoot(a);
  disposeObject(a);
  expect(releasedB).toBe(0);
  disposeObject(b);
  registry.dispose();
});
it('keeps mirrored transforms and non-mesh geometry under an identity wrapper with owned resources', async () => {
  const root = new THREE.Group();
  root.scale.x = -1;
  root.position.set(2, 0, 0);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
    new THREE.LineBasicMaterial(),
  );
  line.visible = false;
  root.add(line);
  const scene = imported(root);
  expect(scene.nodes).toHaveLength(1);
  expect(scene.nodes[0].scale).toEqual([1, 1, 1]);
  const registry = new AssetRegistry(async () => root);
  const a = await registry.loadInstance(asset, scene.nodes[0]),
    b = await registry.loadInstance(asset, scene.nodes[0]);
  expect(a.scale.x).toBe(-1);
  expect(a.children[0].visible).toBe(false);
  expect((a.children[0] as THREE.Line).geometry).not.toBe((b.children[0] as THREE.Line).geometry);
  expect((a.children[0] as THREE.Line).material).not.toBe((b.children[0] as THREE.Line).material);
  disposeObject(a);
  disposeObject(b);
  registry.dispose();
});
it('preserves static CAD-style per-part hierarchy and authored visibility', () => {
  const root = new THREE.Group();
  const part = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  part.visible = false;
  part.position.x = 0.1;
  root.add(part);
  const scene = imported(root);
  expect(scene.nodes).toHaveLength(2);
  expect(scene.nodes[1].assetNode).toBe('0');
  expect(scene.nodes[1].position).toEqual([0.1, 0, 0]);
  expect(scene.nodes[1].visible).toBe(false);
});
it('rejects invalid GLB publication before creating any source, runtime or manifest files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-contract-'));
  roots.push(root);
  await expect(recordUpload(root, Buffer.from('not a glb'), 'bad.glb')).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it('retains validation warnings and keeps STEP source outside runtime output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-contract-'));
  roots.push(root);
  const bytes = jsonGlb({ asset: { version: '2.0' }, materials: [{ alphaCutoff: 0.25 }] });
  const upload = await recordUpload(root, bytes, 'empty.glb');
  expect(upload.manifest.validation?.errors).toBe(0);
  expect(upload.manifest.validation?.warnings).toBeGreaterThan(0);
  const manifest = JSON.parse(
    await readFile(join(root, 'manifests', 'uploads', `${upload.filename}.json`), 'utf8'),
  );
  expect(manifest.validation.messages.length).toBeGreaterThan(0);
  const step = await recordUpload(root, Buffer.from('ISO-10303-21;'), 'part.step');
  expect(step.manifest.output).toBeNull();
  await expect(readFile(join(root, 'optimized', 'uploads', step.filename))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
it('carries GLTFLoader animation metadata through the browser import entry point', async () => {
  const doc = new Document(),
    buffer = doc.createBuffer(),
    target = doc.createNode('Moving');
  doc.createScene().addChild(target);
  const input = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
    .setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
  doc
    .createAnimation('Move')
    .addSampler(sampler)
    .addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(target)
        .setTargetPath('translation')
        .setSampler(sampler),
    );
  const bytes = await new NodeIO().writeBinary(doc);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(asset), { status: 200 }),
  );
  const commands = await importFile(
    new File([Uint8Array.from(bytes)], 'moving.glb'),
    new AbortController().signal,
    () => {},
  );
  const scene = applyCommands(emptyScene(), 0, commands);
  expect(scene.nodes).toHaveLength(1);
  expect(scene.nodes[0].animation?.clip).toBe('Move');
  expect(scene.nodes[0].assetNode).toBeUndefined();
});

function jsonGlb(doc: unknown) {
  const json = Buffer.from(JSON.stringify(doc));
  const bytes = Buffer.alloc(20 + Math.ceil(json.length / 4) * 4, 32);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(bytes.length - 20, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}
it.each([
  { asset: { version: '2.0' }, images: [{ uri: 'https://example.invalid/image.png' }] },
  { asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] },
  { asset: { version: '2.0' }, nodes: [{ mesh: 42 }] },
])('rejects unsupported or structurally invalid uploads without publication: %j', async (doc) => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-contract-'));
  roots.push(root);
  await expect(recordUpload(root, jsonGlb(doc), 'bad.glb')).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
it('rejects a source-only response where browser import expects a runtime asset', async () => {
  const doc = new Document();
  doc.createScene().addChild(doc.createNode());
  const bytes = await new NodeIO().writeBinary(doc);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ...asset, type: 'source' }), { status: 200 }),
  );
  await expect(
    importFile(
      new File([Uint8Array.from(bytes)], 'model.glb'),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
});
it('rejects unknown required glTF extensions before publishing any upload files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-required-'));
  roots.push(root);
  const bytes = jsonGlb({
    asset: { version: '2.0' },
    extensionsUsed: ['VIRTUALWORLD_unavailable'],
    extensionsRequired: ['VIRTUALWORLD_unavailable'],
    extensions: { VIRTUALWORLD_unavailable: {} },
  });
  await expect(recordUpload(root, bytes, 'required.glb')).rejects.toThrow(
    /VIRTUALWORLD_unavailable/,
  );
  expect(await readdir(root)).toEqual([]);
});
it('accepts unknown optional extensions and retains the validator compatibility message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-optional-'));
  roots.push(root);
  const bytes = jsonGlb({
    asset: { version: '2.0' },
    extensionsUsed: ['VIRTUALWORLD_optional'],
    extensions: { VIRTUALWORLD_optional: {} },
  });
  const upload = await recordUpload(root, bytes, 'optional.glb');
  expect(upload.manifest.validation?.errors).toBe(0);
  expect(upload.manifest.validation?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'UNSUPPORTED_EXTENSION',
        message: expect.stringContaining('VIRTUALWORLD_optional'),
      }),
    ]),
  );
});
it('accepts a required material extension supported by the pinned runtime loader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-supported-'));
  roots.push(root);
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
  const doc = await io.readBinary(await validTriangleGlb());
  const extension = doc.createExtension(KHRMaterialsUnlit).setRequired(true);
  const material = doc
    .createMaterial()
    .setExtension('KHR_materials_unlit', extension.createUnlit());
  doc.getRoot().listMeshes()[0].listPrimitives()[0].setMaterial(material);
  const bytes = Buffer.from(await io.writeBinary(doc));
  const upload = await recordUpload(root, bytes, 'unlit.glb');
  expect(upload.manifest.validation?.errors).toBe(0);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const mesh = gltf.scene.children[0] as THREE.Mesh;
  expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
});

it('rejects optional Draco declarations that the pinned loader cannot open without its decoder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vw-upload-optional-draco-'));
  roots.push(root);
  const bytes = glbWithUsedExtension(await validTriangleGlb(), 'KHR_draco_mesh_compression');

  // Core fallback triangles do not help: r180 constructs Draco from extensionsUsed.
  await expect(
    new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    ),
  ).rejects.toThrow(/No DRACOLoader instance provided/);
  await expect(recordUpload(root, bytes, 'optional-draco.glb')).rejects.toThrow(/Draco/);
  expect(await readdir(root)).toEqual([]);
});

it.each(['KHR_texture_basisu', 'EXT_meshopt_compression'])(
  'preserves uncompressed triangle fallback for optional %s declarations',
  async (extension) => {
    const root = await mkdtemp(join(tmpdir(), 'vw-upload-optional-fallback-'));
    roots.push(root);
    const bytes = glbWithUsedExtension(await validTriangleGlb(), extension);
    const upload = await recordUpload(root, bytes, 'optional-fallback.glb');
    expect(upload.manifest.validation?.errors).toBe(0);
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const mesh = gltf.scene.children[0] as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry.getAttribute('position').count).toBe(3);
  },
);

function glbWithUsedExtension(original: Buffer, extension: string) {
  const oldJsonLength = original.readUInt32LE(12);
  const doc = JSON.parse(original.subarray(20, 20 + oldJsonLength).toString());
  doc.extensionsUsed = [extension];
  const json = Buffer.from(JSON.stringify(doc));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const remainingChunks = original.subarray(20 + oldJsonLength);
  const bytes = Buffer.alloc(20 + jsonLength + remainingChunks.length, 0x20);
  original.copy(bytes, 0, 0, 20);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12);
  json.copy(bytes, 20);
  remainingChunks.copy(bytes, 20 + jsonLength);
  return bytes;
}
