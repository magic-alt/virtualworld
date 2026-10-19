import { Document, NodeIO, type Material, type Mesh } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { copyToDocument } from '@gltf-transform/functions';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneNode } from '@virtualworld/scene-schema';
import { assertSelfContainedGlb } from '@virtualworld/asset-runtime';

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
function override(material: Material, node: SceneNode) {
  if (node.materialOverride) {
    const c = new THREE.Color(node.color);
    const a = material.getBaseColorFactor()[3];
    material.setBaseColorFactor([c.r, c.g, c.b, a]);
  }
  if (node.metalness !== undefined) material.setMetallicFactor(node.metalness);
  if (node.roughness !== undefined) material.setRoughnessFactor(node.roughness);
}
export async function importedModel(
  bytes: Uint8Array,
  node: SceneNode,
  report: (code: string, feature: string, message: string) => void = () => {},
): Promise<Uint8Array> {
  assertSelfContainedGlb(Uint8Array.from(bytes).buffer);
  const source = await io().readBinary(bytes);
  if (
    !source
      .getRoot()
      .listMeshes()
      .some((m) => m.listPrimitives().some((p) => p.getAttribute('POSITION')?.getCount()))
  )
    throw new Error('GLB has no mesh geometry');
  let result = source;
  if (node.assetNode !== undefined) {
    if (source.getRoot().listAnimations().length)
      report(
        'ASSETNODE_ANIMATION_UNMAPPED',
        'selected mesh animation',
        'Selected mesh GLB preserves initial mesh/morph resources but does not retarget source animation clips. Use the unchanged whole source GLB to retain all clips.',
      );
    const loader = new GLTFLoader();
    // Only loader structure is needed. NodeIO retains the original embedded images.
    loader.register(() => ({
      name: 'virtualworld-texture-metadata',
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    const gltf = await loader.parseAsync(Uint8Array.from(bytes).buffer, '');
    try {
      let selected: THREE.Object3D = gltf.scene;
      for (const part of node.assetNode.split('.').filter(Boolean)) {
        selected = selected.children[Number(part)];
        if (!selected) throw new Error(`Invalid assetNode: ${node.assetNode}`);
      }
      const association = gltf.parser.associations.get(selected) as
        | { meshes?: number; primitives?: number }
        | undefined;
      if (!(selected instanceof THREE.Mesh) || association?.meshes === undefined)
        throw new Error(`assetNode ${node.assetNode} has no own mesh geometry`);
      if (selected instanceof THREE.SkinnedMesh)
        throw new Error('Selected skinned assetNode requires its skeleton; export the whole GLB');
      const mesh = source.getRoot().listMeshes()[association.meshes];
      result = new Document();
      const copied = copyToDocument(result, source, [mesh]);
      const target = copied.get(mesh) as Mesh;
      if (association.primitives !== undefined)
        for (const [index, p] of target.listPrimitives().entries())
          if (index !== association.primitives) target.removePrimitive(p);
      const canonicalNode = result.createNode('Model').setMesh(target);
      // A glTF node's weights override mesh defaults; clone(false) keeps the
      // pinned loader's effective per-instance values even after resetting TRS.
      if (selected.morphTargetInfluences)
        canonicalNode.setWeights([...selected.morphTargetInfluences]);
      result.createScene('Canonical').addChild(canonicalNode);
    } finally {
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const value of Object.values(m))
              if (value instanceof THREE.Texture) value.dispose();
            m.dispose();
          }
        }
      });
    }
  }
  const overridesRequested =
    Boolean(node.materialOverride) || node.metalness !== undefined || node.roughness !== undefined;
  if (node.assetNode === undefined && !overridesRequested) return bytes;
  if (overridesRequested) {
    let defaultMaterial: Material | undefined;
    for (const mesh of result.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives()) {
        // glTF's implicit PBR material matches the pinned GLTFLoader default:
        // opaque white, metallic=1, roughness=1. Make it explicit only when edited.
        if (!primitive.getMaterial())
          primitive.setMaterial((defaultMaterial ??= result.createMaterial('Runtime default')));
      }
  }
  for (const material of result.getRoot().listMaterials()) override(material, node);
  // copyToDocument can retain several source buffers; GLB requires one.
  const buffer = result.getRoot().listBuffers()[0] ?? result.createBuffer();
  for (const accessor of result.getRoot().listAccessors()) accessor.setBuffer(buffer);
  for (const other of result.getRoot().listBuffers()) if (other !== buffer) other.dispose();
  return io().writeBinary(result);
}

export async function proceduralModel(object: THREE.Object3D): Promise<Uint8Array> {
  const d = new Document(),
    buffer = d.createBuffer();
  const root = d.createNode('Model');
  d.createScene('Canonical').addChild(root);
  const mats = new Map<THREE.Material, Material>();
  let count = 0;
  function mat(m: THREE.Material) {
    let result = mats.get(m);
    if (result) return result;
    const standard = m as THREE.MeshStandardMaterial;
    const c = standard.color ?? new THREE.Color('#ffffff');
    result = d
      .createMaterial(m.name)
      .setBaseColorFactor([c.r, c.g, c.b, m.opacity])
      .setMetallicFactor(standard.metalness ?? 0)
      .setRoughnessFactor(standard.roughness ?? 1)
      .setDoubleSided(m.side === THREE.DoubleSide);
    if (m.transparent) result.setAlphaMode('BLEND');
    if (standard.emissive) {
      const values = standard.emissive.toArray().map((v) => v * (standard.emissiveIntensity ?? 1));
      const strength = Math.max(1, ...values);
      result.setEmissiveFactor(values.map((v) => v / strength) as [number, number, number]);
      if (strength > 1)
        result.setExtension(
          'KHR_materials_emissive_strength',
          d
            .createExtension(KHRMaterialsEmissiveStrength)
            .createEmissiveStrength()
            .setEmissiveStrength(strength),
        );
    }
    mats.set(m, result);
    return result;
  }
  function visit(o: THREE.Object3D, parent: ReturnType<Document['createNode']>) {
    const n = d
      .createNode(o.name)
      .setTranslation(o.position.toArray())
      .setRotation(o.quaternion.toArray())
      .setScale(o.scale.toArray());
    parent.addChild(n);
    if (o instanceof THREE.Mesh) {
      const geometry = o.geometry;
      const mesh = d.createMesh(o.name);
      const groups = geometry.groups.length
        ? geometry.groups
        : [
            {
              start: 0,
              count: geometry.index?.count ?? geometry.attributes.position.count,
              materialIndex: 0,
            },
          ];
      for (const group of groups) {
        const p = d.createPrimitive();
        for (const [name, semantic] of Object.entries({
          position: 'POSITION',
          normal: 'NORMAL',
          uv: 'TEXCOORD_0',
          color: 'COLOR_0',
        })) {
          const attr = geometry.getAttribute(name);
          if (!attr) continue;
          const values = new Float32Array(attr.count * attr.itemSize);
          for (let i = 0; i < attr.count; i++)
            for (let c = 0; c < attr.itemSize; c++)
              values[i * attr.itemSize + c] = attr.getComponent(i, c);
          p.setAttribute(
            semantic,
            d
              .createAccessor()
              .setType((['', 'SCALAR', 'VEC2', 'VEC3', 'VEC4'] as const)[attr.itemSize] || 'VEC3')
              .setArray(values)
              .setBuffer(buffer),
          );
        }
        const indices = new Uint32Array(group.count);
        for (let i = 0; i < group.count; i++)
          indices[i] = geometry.index ? geometry.index.getX(group.start + i) : group.start + i;
        p.setIndices(d.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        p.setMaterial(mat(materials[group.materialIndex ?? 0] ?? materials[0]));
        mesh.addPrimitive(p);
        count++;
      }
      n.setMesh(mesh);
    }
    for (const child of o.children) visit(child, n);
  }
  try {
    visit(object, root);
    if (!count) throw new Error('Procedural model has no mesh geometry');
    return await io().writeBinary(d);
  } finally {
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}
