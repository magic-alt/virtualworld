import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
await mkdir('public/fixtures', { recursive: true });
await mkdir('public/cad', { recursive: true });
for (const file of ['occt-import-js.js', 'occt-import-js.wasm'])
  await copyFile(resolve('node_modules/occt-import-js/dist', file), resolve('public/cad', file));
const props = [
  'x',
  'y',
  'z',
  'nx',
  'ny',
  'nz',
  'f_dc_0',
  'f_dc_1',
  'f_dc_2',
  'opacity',
  'scale_0',
  'scale_1',
  'scale_2',
  'rot_0',
  'rot_1',
  'rot_2',
  'rot_3',
];
const count = 1200,
  header = `ply\nformat binary_little_endian 1.0\ncomment Original VirtualWorld Studio procedural star cloud\nelement vertex ${count}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
const data = Buffer.alloc(count * props.length * 4);
for (let i = 0; i < count; i++) {
  const t = i / count,
    angle = i * 2.399963,
    rad = 1.6 + Math.sin(i * 1.7) * 0.7;
  const values = [
    Math.cos(angle) * rad,
    Math.sin(angle) * rad * 0.7,
    Math.sin(i * 1.43) * 0.35,
    0,
    0,
    0,
    (0.65 + 0.35 * Math.sin(i) - 0.5) / 0.282095,
    (0.82 - 0.5) / 0.282095,
    (1 - 0.5) / 0.282095,
    -0.8,
    Math.log(0.018 + 0.018 * t),
    Math.log(0.018 + 0.018 * t),
    Math.log(0.018),
    1,
    0,
    0,
    0,
  ];
  values.forEach((n, j) => data.writeFloatLE(n, (i * props.length + j) * 4));
}
await writeFile('public/fixtures/stardust.ply', Buffer.concat([Buffer.from(header), data]));
// Upstream OCCT test files are included by its npm package under LGPL-2.1.
async function findStep(dir: string): Promise<string | undefined> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && /\.(step|stp)$/i.test(e.name)) return p;
    if (e.isDirectory()) {
      const found = await findStep(p);
      if (found) return found;
    }
  }
}
for (const [folder, name] of [
  ['cube-10x10mm', 'cube-mm.step'],
  ['cube-units', 'cube-units.step'],
  ['simple-basic-cube', 'cube.step'],
]) {
  const file = await findStep(resolve('node_modules/occt-import-js/test/testfiles', folder));
  if (file) await copyFile(file, resolve('public/fixtures', name));
}
console.log('Prepared original Gaussian Splat, local CAD WASM and STEP test fixtures.');
await copyFile(
  'node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp',
  'public/fixtures/assembly.step',
);
await copyFile(
  'node_modules/occt-import-js/test/testfiles/cax-if/source.txt',
  'public/fixtures/assembly-source.txt',
);
