import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { primitive } from '@virtualworld/engine/geometry';
import { node } from '@virtualworld/scene-schema';
import type { SceneSpec } from '@virtualworld/scene-schema';
import { writeEngineExport } from '@virtualworld/scene-builder/engine-export';
import { validateGlb } from '../../generators/scene-builder/src/pipeline';

const scene = (nodes: SceneSpec['nodes'], id = 'first'): SceneSpec => ({
  version: 1,
  id,
  name: id,
  description: '',
  mode: 'world',
  revision: 0,
  assets: [],
  nodes,
  environment: { background: '#123456', lightIntensity: 1, ambientIntensity: 0.5 },
  camera: { position: [4, 5, 6], target: [0, 0, 0] },
  spawn: [1, 2, 3],
  tasks: [],
});
async function collect(
  scenes: SceneSpec[],
  target: 'unity' | 'godot' = 'godot',
  source = new Uint8Array(),
) {
  const files = new Map<string, Uint8Array>();
  await writeEngineExport({
    target,
    scenes,
    entrySceneId: scenes[0].id,
    assetBytes: () => source,
    primitiveFactory: primitive,
    emit: (path, bytes) => {
      expect(path).not.toMatch(/(^\/|\.\.)/);
      files.set(path, bytes);
    },
  });
  return {
    files,
    manifest: JSON.parse(new TextDecoder().decode(files.get('engine-manifest.json'))),
  };
}
async function sourceGlb() {
  const d = new Document(),
    b = d.createBuffer();
  const texture = d
    .createTexture()
    .setMimeType('image/png')
    .setImage(
      Uint8Array.from(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
          'base64',
        ),
      ),
    );
  const m = d.createMaterial().setBaseColorTexture(texture);
  const mesh = d.createMesh('two primitives');
  for (const offset of [0, 10])
    mesh.addPrimitive(
      d
        .createPrimitive()
        .setAttribute(
          'POSITION',
          d
            .createAccessor()
            .setType('VEC3')
            .setArray(new Float32Array([offset, 0, 0, offset + 2, 0, 0, offset, 3, 0]))
            .setBuffer(b),
        )
        .setAttribute(
          'TEXCOORD_0',
          d
            .createAccessor()
            .setType('VEC2')
            .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
            .setBuffer(b),
        )
        .setMaterial(m),
    );
  const root = d.createNode('translated parent').setTranslation([7, 8, 9]);
  root.addChild(d.createNode('selected').setMesh(mesh).setTranslation([3, 4, 5]));
  d.createScene().addChild(root);
  const sampler = d
    .createAnimationSampler()
    .setInput(
      d
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Float32Array([0, 1]))
        .setBuffer(b),
    )
    .setOutput(
      d
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([7, 8, 9, 8, 8, 9]))
        .setBuffer(b),
    );
  d.createAnimation('Move')
    .addSampler(sampler)
    .addChannel(
      d
        .createAnimationChannel()
        .setTargetNode(root)
        .setTargetPath('translation')
        .setSampler(sampler),
    );
  return new NodeIO().writeBinary(d);
}
async function implicitMaterialMorphSource() {
  const document = new Document(),
    buffer = document.createBuffer();
  const positions = (values: number[]) =>
    document.createAccessor().setType('VEC3').setArray(new Float32Array(values)).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', positions([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .addTarget(
      document
        .createPrimitiveTarget()
        .setAttribute('POSITION', positions([2, 0, 0, 2, 0, 0, 2, 0, 0])),
    );
  const mesh = document.createMesh('Morph').addPrimitive(primitive).setWeights([0.1]);
  document.createScene().addChild(document.createNode('Instance').setMesh(mesh).setWeights([0.75]));
  return new NodeIO().writeBinary(document);
}
async function load(bytes: Uint8Array) {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'headless-textures',
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  return loader.parseAsync(Uint8Array.from(bytes).buffer, '');
}

describe('canonical engine export', () => {
  it('keeps local XYZ joint quaternions, scene identity, hidden hierarchy and radius units', async () => {
    const p = node('parent', 'Parent', 'box', [2, 3, 4], [1, 1, 1], '#112233', {
      kind: 'group',
      visible: false,
      rotation: [0.2, 0.5, 0.8],
      scale: [2, 1, 3],
    });
    const n = node('child', 'Child', 'box', [5, 6, 7], [1, 2, 3], '#abcdef', {
      parentId: p.id,
      rotation: [0.3, 0.4, 0.5],
      joint: { axis: 'y', value: 0.7, min: 0, max: 1, confirmed: true },
      collider: { shape: 'ball', size: [2, 9, 10] },
    });
    const { manifest } = await collect([scene([n, p]), scene([], 'second')]);
    expect(manifest.version).toBe(1);
    expect(manifest.entrySceneId).toBe('first');
    expect(manifest.scenes.map((s: any) => s.id)).toEqual(['first', 'second']);
    const child = manifest.scenes[0].nodes.find((v: any) => v.id === 'child');
    expect(child.translation).toEqual([5, 6, 7]);
    expect(child.rotation).toEqual(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, 0.5, 'XYZ')).toArray(),
    );
    expect(child.effectiveVisible).toBe(false);
    expect(child.collider.size[0]).toBe(2);
    expect(manifest.compatibility).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'NONUNIFORM_COLLIDER_SCALE', nodeId: 'child' }),
      ]),
    );
  });
  it('bakes the actual procedural cylinder and tree at identity roots', async () => {
    const nodes = [
      node('c', 'C', 'cylinder', [9, 8, 7], [2, 4, 6], '#abcdef'),
      node('t', 'T', 'tree', [0, 0, 0], [2, 5, 3], '#abcdef'),
    ];
    const { files, manifest } = await collect([scene(nodes)]);
    for (const n of nodes) {
      const binding = manifest.scenes[0].nodes.find((v: any) => v.id === n.id).model;
      const bytes = files.get(manifest.assets.find((a: any) => a.id === binding).path)!;
      await validateGlb(bytes);
      const gltf = await load(bytes);
      const actual = new THREE.Box3().setFromObject(gltf.scene);
      const expected = new THREE.Box3().setFromObject(primitive(n));
      expect(actual.min.toArray()).toEqual(expected.min.toArray().map((v) => expect.closeTo(v, 5)));
      expect(actual.max.toArray()).toEqual(expected.max.toArray().map((v) => expect.closeTo(v, 5)));
      expect(gltf.scene.children[0].position.toArray()).toEqual([0, 0, 0]);
    }
  });
  it('selects a pinned loader primitive child, strips its transform, preserves embedded image bytes and applies runtime overrides', async () => {
    const bytes = await sourceGlb(),
      original = Uint8Array.from(bytes);
    const n = node('part', 'Part', 'glb', [1, 2, 3], [1, 1, 1], '#ff0000', {
      assetId: 'asset',
      assetNode: '0.0.1',
      materialOverride: true,
      metalness: 0.4,
      roughness: 0.3,
    });
    const s = scene([n]);
    s.assets = [
      { id: 'asset', name: 'Asset', type: 'glb', url: 'assets/source.glb', bytes: bytes.length },
    ];
    const { files, manifest } = await collect([s], 'godot', bytes);
    expect(bytes).toEqual(original);
    const asset = manifest.assets[0];
    expect(manifest.compatibility).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ASSETNODE_ANIMATION_UNMAPPED',
          sceneId: s.id,
          nodeId: n.id,
          assetId: 'asset',
        }),
      ]),
    );
    const normalized = files.get(asset.path)!;
    await validateGlb(normalized);
    const gltf = await load(normalized);
    expect(new THREE.Box3().setFromObject(gltf.scene).min.toArray()).toEqual([10, 0, 0]);
    const d = await new NodeIO().readBinary(normalized);
    expect(d.getRoot().listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(d.getRoot().listTextures()[0].getImage()).toEqual(
      (await new NodeIO().readBinary(bytes)).getRoot().listTextures()[0].getImage(),
    );
    expect(d.getRoot().listMaterials()[0].getBaseColorFactor()).toEqual([1, 0, 0, 1]);
    expect(d.getRoot().listMaterials()[0].getMetallicFactor()).toBe(0.4);
  });
  it('retains untouched whole GLBs and animation clips without reserialization', async () => {
    const bytes = await sourceGlb();
    const n = node('whole', 'Whole', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', { assetId: 'a' });
    const s = scene([n]);
    s.assets = [{ id: 'a', name: 'Asset', type: 'glb', url: 'assets/a.glb', bytes: bytes.length }];
    const { files, manifest } = await collect([s], 'unity', bytes);
    expect(files.get(manifest.assets[0].path)).toEqual(bytes);
    expect(
      (await load(files.get(manifest.assets[0].path)!)).animations.map((clip) => clip.name),
    ).toEqual(['Move']);
    expect(files.has('Editor/VirtualWorldImporter.cs')).toBe(true);
    expect(new TextDecoder().decode(files.get('Editor/VirtualWorldImporter.cs'))).toContain(
      'GenerateUniqueAssetPath',
    );
  });
  it('emits actual Godot project and structured unsupported findings with retained metadata', async () => {
    const n = node('story', 'Story', 'box', [0, 0, 0], [1, 1, 1], '#ffffff', {
      interaction: { title: 'T', text: 'X' },
      animation: { clip: 'Walk' },
    });
    const s = scene([n]);
    s.navigation = { kind: 'sphere', center: [0, 0, 0], radius: 4 };
    const { files, manifest } = await collect([s]);
    expect(files.has('project.godot')).toBe(true);
    expect(files.has('main.tscn')).toBe(true);
    expect(files.has('inspect.gd')).toBe(true);
    expect([...files.keys()].some((p) => p.startsWith('raw/') && p.endsWith('.glb.bin'))).toBe(
      true,
    );
    expect(manifest.compatibility).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'GAMEPLAY_UNMAPPED',
          sceneId: s.id,
          nodeId: n.id,
          severity: 'warning',
        }),
        expect.objectContaining({ code: 'ANIMATION_PLAYBACK_UNMAPPED' }),
        expect.objectContaining({ code: 'SPHERICAL_NAVIGATION_UNMAPPED' }),
      ]),
    );
    expect(manifest.scenes[0].nodes[0].metadata.interaction).toEqual(n.interaction);
  });
  it('rejects invalid entry points, invalid assetNode and empty selected groups', async () => {
    await expect(
      writeEngineExport({
        target: 'invalid' as any,
        scenes: [scene([])],
        entrySceneId: 'first',
        assetBytes: () => new Uint8Array(),
        primitiveFactory: primitive,
        emit: () => {},
      }),
    ).rejects.toThrow(/target/i);
    const bytes = await sourceGlb();
    const n = node('bad', 'Bad', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
      assetId: 'a',
      assetNode: '0',
    });
    const s = scene([n]);
    s.assets = [{ id: 'a', name: 'A', type: 'glb', url: 'assets/a.glb', bytes: bytes.length }];
    await expect(collect([s], 'godot', bytes)).rejects.toThrow(/geometry|mesh/i);
    n.assetNode = '8';
    await expect(collect([s], 'godot', bytes)).rejects.toThrow(/assetNode/i);
  });
  it('deduplicates model content while retaining every source identity and requested entry scene', async () => {
    const bytes = await sourceGlb();
    const scenes = ['first', 'second'].map((id, index) => {
      const s = scene(
        [
          node('whole', 'Whole', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
            assetId: 'asset' + index,
          }),
        ],
        id,
      );
      s.assets = [
        {
          id: 'asset' + index,
          name: 'Source',
          type: 'glb',
          url: 'assets/' + id + '.glb',
          bytes: bytes.length,
        },
      ];
      return s;
    });
    const files = new Map<string, Uint8Array>();
    await writeEngineExport({
      target: 'godot',
      scenes,
      entrySceneId: 'second',
      assetBytes: () => bytes,
      primitiveFactory: primitive,
      emit: (path, content) => {
        files.set(path, content);
      },
    });
    const manifest = JSON.parse(new TextDecoder().decode(files.get('engine-manifest.json')));
    expect(manifest.entrySceneId).toBe('second');
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].sources.map((s: any) => [s.sceneId, s.assetId, s.url])).toEqual([
      ['first', 'asset0', 'assets/first.glb'],
      ['second', 'asset1', 'assets/second.glb'],
    ]);
    expect([...files.keys()].filter((p) => p.startsWith('models/'))).toHaveLength(1);
  });
  it('writes valid high intensity emissive materials', async () => {
    const { files, manifest } = await collect([
      scene([node('bright', 'Bright', 'box', [0, 0, 0], [1, 1, 1], '#ffffff', { emissive: 5 })]),
    ]);
    const bytes = files.get(manifest.assets[0].path)!;
    await validateGlb(bytes);
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
    expect(doc.getRoot().listMaterials()[0].getEmissiveFactor()).toEqual([1, 1, 1]);
    expect(
      doc
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName),
    ).toContain('KHR_materials_emissive_strength');
  });
  it('normalizes a real authored morph mesh through the pinned loader mapping', async () => {
    const bytes = readFileSync(
      new URL('../../assets/optimized/showcase/harmonic-joint.glb', import.meta.url),
    );
    const gltf = await load(bytes);
    let selected: THREE.Mesh | undefined;
    gltf.scene.traverse((o) => {
      if (!selected && o instanceof THREE.Mesh && o.morphTargetDictionary?.WaveCos !== undefined)
        selected = o;
    });
    expect(selected).toBeDefined();
    const path: number[] = [];
    let cursor: THREE.Object3D = selected!;
    while (cursor !== gltf.scene) {
      path.unshift(cursor.parent!.children.indexOf(cursor));
      cursor = cursor.parent!;
    }
    const n = node('real', 'Real', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
      assetId: 'real',
      assetNode: path.join('.'),
    });
    const s = scene([n]);
    s.assets = [
      { id: 'real', name: 'Real', type: 'glb', url: 'assets/real.glb', bytes: bytes.length },
    ];
    const { files, manifest } = await collect([s], 'godot', bytes);
    const canonical = files.get(manifest.assets[0].path)!;
    await validateGlb(canonical);
    const derived = await load(canonical);
    const meshes: THREE.Mesh[] = [];
    derived.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].morphTargetDictionary).toEqual(selected!.morphTargetDictionary);
    const values = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
      Array.from({ length: attribute.count }, (_, i) => [
        attribute.getX(i),
        attribute.getY(i),
        attribute.getZ(i),
      ]);
    expect(values(meshes[0].geometry.getAttribute('position'))).toEqual(
      values(selected!.geometry.getAttribute('position')),
    );
    expect(values(meshes[0].geometry.morphAttributes.position![0])).toEqual(
      values(selected!.geometry.morphAttributes.position![0]),
    );
  });
  it('preserves effective selected node morph weights overriding mesh defaults and actual deformation', async () => {
    const bytes = await implicitMaterialMorphSource();
    const authored = await load(bytes);
    const original = authored.scene.children[0] as THREE.Mesh;
    expect(original.morphTargetInfluences).toEqual([0.75]);
    const n = node('morph', 'Morph', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
      assetId: 'morph',
      assetNode: '0',
    });
    const s = scene([n]);
    s.assets = [
      { id: 'morph', name: 'Morph', type: 'glb', url: 'assets/morph.glb', bytes: bytes.length },
    ];
    const { files, manifest } = await collect([s], 'godot', bytes);
    const canonical = files.get(manifest.assets[0].path)!;
    await validateGlb(canonical);
    const derived = await load(canonical);
    const selected = derived.scene.children[0] as THREE.Mesh;
    expect(selected.morphTargetInfluences).toEqual([0.75]);
    expect(selected.getVertexPosition(0, new THREE.Vector3()).toArray()).toEqual([1.5, 0, 0]);
    expect(
      (await new NodeIO().readBinary(canonical)).getRoot().listNodes()[0].getWeights(),
    ).toEqual([0.75]);
  });
  for (const assetNode of [undefined, '0']) {
    it.each([
      { materialOverride: true, metalness: 0.25, roughness: 0.35 },
      { metalness: 0.25 },
      { roughness: 0.35 },
    ])(
      'applies runtime overrides to missing default material (' + String(assetNode) + '): %j',
      async (overrides) => {
        const bytes = await implicitMaterialMorphSource();
        const n = node('default', 'Default', 'glb', [0, 0, 0], [1, 1, 1], '#ff0000', {
          assetId: 'default',
          assetNode,
          ...overrides,
        });
        const s = scene([n]);
        s.assets = [
          {
            id: 'default',
            name: 'Default',
            type: 'glb',
            url: 'assets/default.glb',
            bytes: bytes.length,
          },
        ];
        const { files, manifest } = await collect([s], 'godot', bytes);
        const canonical = files.get(manifest.assets[0].path)!;
        await validateGlb(canonical);
        const derived = await load(canonical);
        let material: THREE.MeshStandardMaterial | undefined;
        derived.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) material = o.material as THREE.MeshStandardMaterial;
        });
        expect(material!.color.toArray()).toEqual(
          overrides.materialOverride ? [1, 0, 0] : [1, 1, 1],
        );
        expect(material!.metalness).toBe(overrides.metalness ?? 1);
        expect(material!.roughness).toBe(overrides.roughness ?? 1);
        const document = await new NodeIO().readBinary(canonical);
        expect(document.getRoot().listMeshes()[0].listPrimitives()[0].getMaterial()).not.toBeNull();
      },
    );
  }
  it('rejects external GLB resource paths before structural readers can access them', async () => {
    const json = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: '/tmp/virtualworld-private-buffer.bin', byteLength: 36 }],
    });
    const padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' ');
    const bytes = new Uint8Array(20 + padded.length);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, 0x46546c67, true);
    header.setUint32(4, 2, true);
    header.setUint32(8, bytes.length, true);
    header.setUint32(12, padded.length, true);
    header.setUint32(16, 0x4e4f534a, true);
    bytes.set(new TextEncoder().encode(padded), 20);
    const s = scene([node('a', 'A', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', { assetId: 'a' })]);
    s.assets = [{ id: 'a', name: 'A', type: 'glb', url: 'assets/a.glb', bytes: bytes.length }];
    await expect(collect([s], 'godot', bytes)).rejects.toThrow(/外部资源/);
  });
  it('propagates immediate emit budget errors and cancellation', async () => {
    const options = {
      target: 'godot' as const,
      scenes: [scene([node('a', 'A', 'box', [0, 0, 0], [1, 1, 1], '#ffffff')])],
      entrySceneId: 'first',
      assetBytes: () => new Uint8Array(),
      primitiveFactory: primitive,
      emit: () => {
        throw new Error('budget');
      },
    };
    await expect(writeEngineExport(options)).rejects.toThrow('budget');
    const controller = new AbortController();
    controller.abort();
    await expect(writeEngineExport({ ...options, signal: controller.signal })).rejects.toThrow(
      /abort/i,
    );
  });
});
