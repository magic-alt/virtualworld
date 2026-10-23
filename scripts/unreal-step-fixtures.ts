/** Local real STEP fixtures for the native automation test; no provider or network. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { convertStep } from '../generators/scene-builder/src/step-import';

const root = resolve(process.argv[2] || 'output/unreal-step-fixtures');
await mkdir(root, { recursive: true });
for (const [input, name] of [
  ['cube-mm.step', 'cube'],
  ['assembly.step', 'assembly'],
])
  await convertStep(`public/fixtures/${input}`, join(root, name));

// A canonical hash is insufficient: the native loader must reject empty geometry before swapping.
const doc = new Document();
doc.createScene('Empty');
const bytes = await new NodeIO().writeBinary(doc);
const id = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'cube/engine-manifest.json'), 'utf8'));
manifest.assets[0] = { id, sha256: id, path: `models/${id}.glb`, bytes: bytes.length };
manifest.scenes[0].nodes[0].model = id;
await mkdir(join(root, 'empty/models'), { recursive: true });
await writeFile(join(root, `empty/models/${id}.glb`), bytes);
await writeFile(join(root, 'empty/engine-manifest.json'), JSON.stringify(manifest));
await writeFile(join(root, 'empty/scene.json'), await readFile(join(root, 'cube/scene.json')));
await writeFile(
  join(root, 'empty/validation.json'),
  JSON.stringify({ errors: 0, warnings: 0, glbSha256: id }),
);
console.log(`Prepared native STEP fixtures: ${root}`);
