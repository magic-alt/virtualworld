/** Append a walkable sand horizon while retaining every original landmark byte. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const validator = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(bytes: Uint8Array): Promise<{
    issues: { numErrors: number; numWarnings: number; messages: unknown[] };
  }>;
};

const extensionName = 'Desert horizon';
const innerRadius = 11;
const outerRadius = 110;
const sideSegments = 128;

function height(x: number, z: number) {
  // Exact Y-up equivalent of the original Blender desert surface at the seam.
  const edge = Math.min(1, Math.max(0, (Math.hypot(x, z) - 3) / 4));
  const original =
    edge *
      (0.35 * Math.sin(x * 0.7 - z * 0.22) -
        0.23 * Math.sin(z * 0.8) +
        0.12 * Math.cos(x * 1.2) +
        0.018 * Math.sin(x * 14 - z * 2 - Math.sin(z))) -
    0.08;
  const t = Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - innerRadius) / 16));
  const blend = t * t * (3 - 2 * t);
  const dunes =
    0.9 * Math.sin(x * 0.075 + z * 0.032) +
    0.65 * Math.cos(z * 0.049 - x * 0.02) +
    0.35 * Math.sin(x * 0.037 - z * 0.056) -
    0.08;
  return original * (1 - blend) + dunes * blend;
}

export function extendDesert(input: Uint8Array): Uint8Array {
  const bytes = Buffer.from(input);
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  if (doc.asset.extras?.desertHorizon?.version === 1) return input;
  if (doc.nodes.some((node: { name?: string }) => node.name === extensionName))
    throw new Error('Rebuild the original desert before replacing its horizon');
  const sand = doc.materials.findIndex(
    (material: { name?: string }) => material.name === 'Ochre sand',
  );
  if (sand < 0 || doc.buffers.length !== 1 || doc.buffers[0].uri)
    throw new Error('Expected the self-contained authored desert GLB');
  const binaryOffset = 28 + jsonLength;
  const sourceNode = doc.nodes.find((node: { name?: string }) => node.name === 'Sculpted dunes');
  if (!sourceNode || sourceNode.rotation || sourceNode.translation || sourceNode.scale)
    throw new Error('Expected the original untransformed sand surface');
  const source = doc.meshes[sourceNode.mesh].primitives[0];
  const attribute = (name: string, index: number, width: number): number[] => {
    const accessor = doc.accessors[source.attributes[name]];
    const view = doc.bufferViews[accessor.bufferView];
    const offset =
      binaryOffset +
      (view.byteOffset ?? 0) +
      (accessor.byteOffset ?? 0) +
      index * (view.byteStride ?? width * 4);
    return Array.from({ length: width }, (_, axis) => bytes.readFloatLE(offset + axis * 4));
  };
  const perimeter = new Map<
    string,
    { position: number[]; normal: number[]; uv: number[]; tangent: number[] }
  >();
  for (let i = 0; i < doc.accessors[source.attributes.POSITION].count; i++) {
    const position = attribute('POSITION', i, 3);
    if (Math.abs(position[0]) === innerRadius || Math.abs(position[2]) === innerRadius)
      perimeter.set(`${position[0]},${position[2]}`, {
        position,
        normal: attribute('NORMAL', i, 3),
        uv: attribute('TEXCOORD_0', i, 2),
        tangent: attribute('TANGENT', i, 4),
      });
  }
  if (perimeter.size !== 4 * sideSegments) throw new Error('Unexpected authored desert perimeter');

  // Matching all 512 original boundary vertices avoids T-junctions and cracks.
  const radii = [11, 11.5, ...Array.from({ length: outerRadius - 11 }, (_, i) => i + 12)];
  const ringSize = 4 * sideSegments;
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    tangents: number[] = [],
    indices: number[] = [];
  for (const radius of radii) {
    for (let side = 0; side < 4; side++)
      for (let i = 0; i < sideSegments; i++) {
        const t = -radius + (2 * radius * i) / sideSegments;
        const [x, z] = [
          [radius, t],
          [-t, radius],
          [-radius, -t],
          [t, -radius],
        ][side];
        const seamT = -innerRadius + (2 * innerRadius * i) / sideSegments;
        const [seamX, seamZ] = [
          [innerRadius, seamT],
          [-seamT, innerRadius],
          [-innerRadius, -seamT],
          [seamT, -innerRadius],
        ][side];
        const seam = perimeter.get(`${seamX},${seamZ}`)!;
        if (radius === innerRadius) {
          positions.push(...seam.position);
          normals.push(...seam.normal);
          uvs.push(...seam.uv);
          tangents.push(...seam.tangent);
          continue;
        }
        const y = height(x, z);
        const epsilon = 0.005;
        const dx = (height(x + epsilon, z) - height(x - epsilon, z)) / (2 * epsilon);
        const dz = (height(x, z + epsilon) - height(x, z - epsilon)) / (2 * epsilon);
        positions.push(x, y, z);
        const length = Math.hypot(dx, 1, dz);
        const blend = Math.min(1, radius - innerRadius);
        const normal = [-dx / length, 1 / length, -dz / length].map(
          (value, axis) => seam.normal[axis] * (1 - blend) + value * blend,
        );
        const normalLength = Math.hypot(...normal);
        for (let axis = 0; axis < 3; axis++) normal[axis] /= normalLength;
        normals.push(...normal);
        // Match Blender's serialized V mapping and retain the shared material's authored tangent basis.
        uvs.push(x * 0.25, 1 + z * 0.25 - y * 0.13);
        const dzdu = (0.13 * dx) / (0.25 - 0.13 * dz);
        const direction = [1, dx + dz * dzdu, dzdu];
        const directionLength = Math.hypot(...direction);
        const tangent = direction.map(
          (value, axis) => seam.tangent[axis] * (1 - blend) + (value / directionLength) * blend,
        );
        const dot = tangent.reduce((sum, value, axis) => sum + value * normal[axis], 0);
        for (let axis = 0; axis < 3; axis++) tangent[axis] -= normal[axis] * dot;
        const tangentLength = Math.hypot(...tangent);
        tangents.push(...tangent.map((value) => value / tangentLength), seam.tangent[3]);
      }
  }
  for (let ring = 0; ring < radii.length - 1; ring++)
    for (let i = 0; i < ringSize; i++) {
      const a = ring * ringSize + i;
      const b = ring * ringSize + ((i + 1) % ringSize);
      const c = a + ringSize;
      const d = b + ringSize;
      indices.push(a, b, c, b, d, c);
    }

  const parts: Buffer[] = [bytes.subarray(binaryOffset, binaryOffset + doc.buffers[0].byteLength)];
  let byteLength = parts[0].length;
  const accessor = (
    values: Float32Array | Uint32Array,
    type: string,
    width: number,
    target: number,
    bounds = false,
  ) => {
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) {
      parts.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const bufferView = doc.bufferViews.length;
    const data = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target });
    parts.push(data);
    byteLength += data.length;
    const entry: Record<string, unknown> = {
      bufferView,
      componentType: values instanceof Uint32Array ? 5125 : 5126,
      count: values.length / width,
      type,
    };
    if (bounds) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i++) {
        min[i % 3] = Math.min(min[i % 3], values[i]);
        max[i % 3] = Math.max(max[i % 3], values[i]);
      }
      entry.min = min;
      entry.max = max;
    }
    const id = doc.accessors.length;
    doc.accessors.push(entry);
    return id;
  };
  const primitive = {
    attributes: {
      POSITION: accessor(new Float32Array(positions), 'VEC3', 3, 34962, true),
      NORMAL: accessor(new Float32Array(normals), 'VEC3', 3, 34962),
      TEXCOORD_0: accessor(new Float32Array(uvs), 'VEC2', 2, 34962),
      TANGENT: accessor(new Float32Array(tangents), 'VEC4', 4, 34962),
    },
    indices: accessor(new Uint32Array(indices), 'SCALAR', 1, 34963),
    material: sand,
  };
  const mesh = doc.meshes.length;
  doc.meshes.push({ name: extensionName, primitives: [primitive] });
  const node = doc.nodes.length;
  doc.nodes.push({ name: extensionName, mesh });
  doc.scenes[doc.scene ?? 0].nodes.push(node);
  doc.buffers[0].byteLength = byteLength;
  doc.asset.extras = {
    ...doc.asset.extras,
    desertHorizon: {
      version: 1,
      innerRadius,
      outerRadius,
      source: 'generators/blender/prince/extend-desert.ts',
    },
  };
  const json = Buffer.from(JSON.stringify(doc));
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(paddedJson);
  const binary = Buffer.concat(parts);
  const paddedBinary = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(paddedBinary);
  const header = Buffer.alloc(20),
    binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + paddedBinary.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(paddedBinary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, paddedJson, binaryHeader, paddedBinary]);
}

export async function buildDesertHorizon() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const file = path.join(root, 'assets/optimized/showcase/prince-desert.glb');
  const bytes = Buffer.from(extendDesert(await readFile(file)));
  const report = await validator.validateBytes(bytes);
  if (report.issues.numErrors || report.issues.numWarnings)
    throw new Error(
      'Desert horizon failed glTF validation: ' + JSON.stringify(report.issues.messages),
    );
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const receiptPath = path.join(root, 'assets/manifests/showcase/prince-desert.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  Object.assign(receipt, {
    generator: 'Blender 5.2 fixed offline recipe + deterministic sand horizon',
    postprocess: 'generators/blender/prince/extend-desert.ts',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    meshes: doc.meshes.length,
    primitives: doc.meshes.reduce(
      (sum: number, mesh: { primitives: unknown[] }) => sum + mesh.primitives.length,
      0,
    ),
    triangles: doc.meshes.reduce(
      (sum: number, mesh: { primitives: { indices: number }[] }) =>
        sum + mesh.primitives.reduce((count, p) => count + doc.accessors[p.indices].count / 3, 0),
      0,
    ),
    validator: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
    warnings: report.issues.messages,
    terrain: {
      width: 220,
      depth: 220,
      authoredCenterWidth: 22,
      walkableBounds: { min: [-100, -100], max: [100, 100] },
    },
  });
  await writeFile(file, bytes);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesertHorizon();
  await import(new URL('./bundles.mjs', import.meta.url).href);
}
