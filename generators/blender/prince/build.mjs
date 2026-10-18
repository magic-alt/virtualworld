import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import validator from 'gltf-validator';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const blender =
  process.env.BLENDER_PATH || 'E:/Software/Blender Foundation/Blender 5.2/blender.exe';
const targets = process.argv.slice(2);
const allowed = new Set(['character', 'pilot', 'fox', 'desert', 'b612', 'earth']);
if (targets.some((target) => !allowed.has(target))) throw new Error('Unknown Prince asset target');
const run = spawnSync(
  blender,
  [
    '--background',
    '--python-exit-code',
    '1',
    '--python',
    'generators/blender/prince/build.py',
    ...(targets.length ? ['--', ...targets] : []),
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status || 1);
for (const name of ['character', 'pilot', 'fox', 'desert', 'b612', 'earth']) {
  const receiptPath = path.join(root, 'assets/manifests/showcase/prince-' + name + '.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const assetPath = path.join(root, 'assets/optimized/showcase/prince-' + name + '.glb');
  const original = readFileSync(assetPath);
  const jsonLength = original.readUInt32LE(12);
  const doc = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
  // Blender emits tangents globally, including primitives without normal maps.
  // Those unused tangents can be undefined on collapsed UV poles. Remove the
  // unused semantic instead of fabricating a normal-map basis for plain PBR.
  for (const mesh of doc.meshes)
    for (const primitive of mesh.primitives)
      if (!doc.materials[primitive.material]?.normalTexture) delete primitive.attributes.TANGENT;
  const encoded = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const binary = original.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  original.copy(header, 0, 0, 12);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bytes = Buffer.concat([header, padded, binary]);
  writeFileSync(assetPath, bytes);
  receipt.sha256 = createHash('sha256').update(bytes).digest('hex');
  receipt.bytes = bytes.length;
  const report = await validator.validateBytes(
    new Uint8Array(
      readFileSync(path.join(root, 'assets/optimized/showcase/prince-' + name + '.glb')),
    ),
  );
  receipt.validator = { errors: report.issues.numErrors, warnings: report.issues.numWarnings };
  receipt.warnings = report.issues.messages;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  if (report.issues.numErrors) throw new Error(name + ': glTF validation errors; inspect receipt');
}
await import('./bundles.mjs');
