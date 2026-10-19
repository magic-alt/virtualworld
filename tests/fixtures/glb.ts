import { Document, NodeIO } from '@gltf-transform/core';

/** Small valid geometry for publication/export tests; no provider or model fixture. */
export async function validTriangleGlb() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const mesh = doc
    .createMesh('Triangle')
    .addPrimitive(doc.createPrimitive().setAttribute('POSITION', positions));
  doc.createScene().addChild(doc.createNode('Triangle').setMesh(mesh));
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

/** Deliberately unvalidated JSON for malformed/unsupported GLB regressions. */
export function glbWithJson(json: unknown) {
  const text = Buffer.from(JSON.stringify(json));
  const length = Math.ceil(text.length / 4) * 4;
  const bytes = Buffer.alloc(20 + length, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  text.copy(bytes, 20);
  return bytes;
}
