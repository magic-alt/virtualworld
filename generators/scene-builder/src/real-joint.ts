import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import {
  applyCommands,
  CadMechanismSchema,
  type CadMechanism,
  type SceneSpec,
} from '@virtualworld/scene-schema';

type Vec3 = [number, number, number];
export interface CadMeshEvidence {
  gltfNodeIndex: number;
  meshIndex: number;
  path: string;
  center: Vec3;
  size: Vec3;
  sphere?: { center: Vec3; radius: number; maxRadialError: number };
}

/** Least squares on actual serialized surface vertices, normalized to avoid tiny CAD scales. */
function sphereFit(points: Vector3[], origin: Vector3, scale: number): CadMeshEvidence['sphere'] {
  if (points.length < 8 || scale <= 0) return;
  const a = Array.from({ length: 4 }, () => Array(5).fill(0));
  for (const point of points) {
    const p = point.clone().sub(origin).divideScalar(scale);
    const row = [p.x, p.y, p.z, 1],
      v = p.lengthSq();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) a[i][j] += row[i] * row[j];
      a[i][4] += row[i] * v;
    }
  }
  for (let i = 0; i < 4; i++) {
    let best = i;
    for (let j = i + 1; j < 4; j++) if (Math.abs(a[j][i]) > Math.abs(a[best][i])) best = j;
    [a[i], a[best]] = [a[best], a[i]];
    if (Math.abs(a[i][i]) < 1e-10) return;
    const divisor = a[i][i];
    for (let k = i; k < 5; k++) a[i][k] /= divisor;
    for (let j = 0; j < 4; j++)
      if (j !== i) {
        const factor = a[j][i];
        for (let k = i; k < 5; k++) a[j][k] -= factor * a[i][k];
      }
  }
  const c = new Vector3(a[0][4], a[1][4], a[2][4]).multiplyScalar(0.5);
  const squared = a[3][4] + c.lengthSq();
  if (squared <= 0) return;
  const radius = Math.sqrt(squared) * scale,
    center = c.multiplyScalar(scale).add(origin);
  let maxRadialError = 0;
  for (const p of points)
    maxRadialError = Math.max(maxRadialError, Math.abs(p.distanceTo(center) - radius));
  if (maxRadialError > radius * 0.02) return;
  return { center: center.toArray(), radius, maxRadialError };
}

/** Inventory identities and SI coordinates from the FINAL GLB, never parser-order guesses. */
export async function inspectCadGlb(bytes: Uint8Array) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
  const nodes = doc.getRoot().listNodes(),
    indices = new Map(nodes.map((n, i) => [n, i]));
  const paths = new Map<(typeof nodes)[number], string>();
  const path = (n: (typeof nodes)[number]): string => {
    const cached = paths.get(n);
    if (cached) return cached;
    const parent = n.getParentNode();
    const result = (parent ? path(parent) : '') + `/${indices.get(n)}:${n.getName() || 'unnamed'}`;
    paths.set(n, result);
    return result;
  };
  const meshes: CadMeshEvidence[] = [];
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const [gltfNodeIndex, n] of nodes.entries()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const matrix = n.getWorldMatrix(),
      points: Vector3[] = [];
    const lo = new Vector3(Infinity, Infinity, Infinity),
      hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      if (!positions) continue;
      for (let i = 0; i < positions.getCount(); i++) {
        const v = positions.getElement(i, []);
        const p = new Vector3(
          matrix[0] * v[0] + matrix[4] * v[1] + matrix[8] * v[2] + matrix[12],
          matrix[1] * v[0] + matrix[5] * v[1] + matrix[9] * v[2] + matrix[13],
          matrix[2] * v[0] + matrix[6] * v[1] + matrix[10] * v[2] + matrix[14],
        );
        if (!p.toArray().every(Number.isFinite)) throw new Error('Non-finite CAD vertex');
        points.push(p);
        lo.min(p);
        hi.max(p);
      }
    }
    if (!points.length) throw new Error(`No visible geometry in node ${gltfNodeIndex}`);
    min.min(lo);
    max.max(hi);
    const center = lo.clone().add(hi).multiplyScalar(0.5),
      size = hi.clone().sub(lo);
    meshes.push({
      gltfNodeIndex,
      meshIndex: doc.getRoot().listMeshes().indexOf(mesh),
      path: path(n),
      center: center.toArray(),
      size: size.toArray(),
      sphere: sphereFit(points, center, size.length()),
    });
  }
  if (!meshes.length) throw new Error('No CAD meshes');
  return {
    modelSha256: createHash('sha256').update(bytes).digest('hex'),
    meshes,
    size: max.clone().sub(min).toArray(),
    center: min.clone().add(max).multiplyScalar(0.5).toArray(),
  };
}

/** Atomic authoring only. Unknown solids remain explicit static bindings. No CAD bytes are changed. */
export async function prepareRealJoint(scene: SceneSpec, bytes: Uint8Array, input: CadMechanism) {
  const mechanism = CadMechanismSchema.parse(input),
    inventory = await inspectCadGlb(bytes);
  if (mechanism.modelSha256 !== inventory.modelSha256)
    throw new Error('Final CAD GLB hash mismatch');
  const model = scene.nodes.find((n) => n.id === mechanism.modelNodeId);
  if (!model || model.shape !== 'glb' || !model.assetId)
    throw new Error('CAD model node must reference a GLB asset');
  const byIndex = new Map(inventory.meshes.map((m) => [m.gltfNodeIndex, m]));
  for (const binding of mechanism.bindings) {
    const mesh = byIndex.get(binding.gltfNodeIndex);
    if (!mesh) throw new Error(`Missing mesh node ${binding.gltfNodeIndex}`);
    if (mesh.path !== binding.originalPath)
      throw new Error(`Stale CAD path at node ${binding.gltfNodeIndex}`);
  }
  const bound = new Set(mechanism.bindings.map((b) => b.gltfNodeIndex));
  for (const mesh of inventory.meshes)
    if (!bound.has(mesh.gltfNodeIndex))
      mechanism.bindings.push({
        gltfNodeIndex: mesh.gltfNodeIndex,
        originalPath: mesh.path,
        role: 'unknown',
        pivot: mesh.center,
        axis: [0, 0, 1],
        group: 'unbound',
      });
  const commands = [{ type: 'configureScene' as const, patch: { mechanism } }];
  return {
    scene: applyCommands(scene, scene.revision, commands),
    commands,
    report: {
      modelSha256: inventory.modelSha256,
      sourceSha256: mechanism.sourceSha256,
      size: inventory.size,
      meshes: inventory.meshes.length,
      movingBindings: mechanism.bindings.filter(
        (b) => !['unknown', 'fixed', 'outer-race'].includes(b.role),
      ).length,
      unknownBindings: mechanism.bindings.filter((b) => b.role === 'unknown').length,
      gear: mechanism.gear,
    },
  };
}
