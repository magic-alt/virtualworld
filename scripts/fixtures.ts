import { mkdir, writeFile, copyFile, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { OctahedronGeometry, Color } from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { optimizeGlb, atomicWrite, sha256 } from '@virtualworld/scene-builder/pipeline';
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
const cloudRecipe = JSON.parse(
  await readFile('assets/source/builtin/stardust.recipe.json', 'utf8'),
);
const count = cloudRecipe.count as number,
  header = `ply\nformat binary_little_endian 1.0\ncomment Original VirtualWorld Studio procedural star cloud\nelement vertex ${count}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
const data = Buffer.alloc(count * props.length * 4);
for (let i = 0; i < count; i++) {
  const t = i / count,
    angle = i * cloudRecipe.angularStep,
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
const cloud = Buffer.concat([Buffer.from(header), data]);
await writeFile('public/fixtures/stardust.ply', cloud); // Legacy saved-project URL.
await atomicWrite('assets/optimized/builtin/stardust.ply', cloud);
await atomicWrite(
  'assets/manifests/builtin/stardust.json',
  JSON.stringify(
    {
      version: 1,
      id: 'stardust',
      source: 'source/builtin/stardust.recipe.json',
      sourceSha256: sha256(await readFile('assets/source/builtin/stardust.recipe.json')),
      output: 'optimized/builtin/stardust.ply',
      outputSha256: sha256(cloud),
      bytes: cloud.length,
      tools: { generator: cloudRecipe.generator },
      validation: { gaussianCount: count },
    },
    null,
    2,
  ) + '\n',
);
const starRecipe = JSON.parse(await readFile('assets/source/builtin/star.recipe.json', 'utf8'));
const geometry = new OctahedronGeometry(starRecipe.radius).scale(
  ...(starRecipe.scale as [number, number, number]),
);
const doc = new Document(),
  buffer = doc.createBuffer();
const primitive = doc.createPrimitive();
for (const [name, semantic] of [
  ['position', 'POSITION'],
  ['normal', 'NORMAL'],
] as const) {
  primitive.setAttribute(
    semantic,
    doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(geometry.getAttribute(name).array))
      .setBuffer(buffer),
  );
}
const starColor = new Color(starRecipe.color);
primitive.setMaterial(
  doc
    .createMaterial('Star crystal')
    .setBaseColorFactor([starColor.r, starColor.g, starColor.b, 1])
    .setEmissiveFactor([
      starColor.r * starRecipe.emissive,
      starColor.g * starRecipe.emissive,
      starColor.b * starRecipe.emissive,
    ])
    .setRoughnessFactor(0.72),
);
doc
  .createScene('Star')
  .addChild(doc.createNode('Star').setMesh(doc.createMesh('Star').addPrimitive(primitive)));
const starSource = await new NodeIO().writeBinary(doc);
geometry.dispose();
await atomicWrite('assets/source/builtin/star.glb', starSource);
const starResult = await optimizeGlb(starSource, 'assets/optimized/builtin/star.glb');
await atomicWrite(
  'assets/manifests/builtin/star.json',
  JSON.stringify(
    {
      id: 'builtin-star',
      recipe: 'source/builtin/star.recipe.json',
      recipeSha256: sha256(await readFile('assets/source/builtin/star.recipe.json')),
      source: 'source/builtin/star.glb',
      output: 'optimized/builtin/star.glb',
      ...starResult,
    },
    null,
    2,
  ) + '\n',
);
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
  if (file) {
    await copyFile(file, resolve('public/fixtures', name));
    await atomicWrite(`assets/source/vendor/occt/${name}`, await readFile(file));
  }
}
console.log('Prepared original Gaussian Splat, local CAD WASM and STEP test fixtures.');
await copyFile(
  'node_modules/occt-import-js/test/testfiles/cax-if/as1-oc-214.stp',
  'public/fixtures/assembly.step',
);
const assembly = await readFile('public/fixtures/assembly.step');
await atomicWrite('assets/source/vendor/occt/assembly.step', assembly);
await atomicWrite(
  'assets/manifests/builtin/occt-samples.json',
  JSON.stringify(
    {
      version: 1,
      provider: 'occt-import-js',
      versionPinned: '0.0.23',
      license: 'LGPL-2.1',
      source: 'https://github.com/kovacsv/occt-import-js/tree/0.0.23/test/testfiles',
      files: await Promise.all(
        ['cube-mm.step', 'cube-units.step', 'cube.step', 'assembly.step'].map(async (name) => {
          const bytes = await readFile(`assets/source/vendor/occt/${name}`);
          return { path: `source/vendor/occt/${name}`, sha256: sha256(bytes), bytes: bytes.length };
        }),
      ),
    },
    null,
    2,
  ) + '\n',
);
await copyFile(
  'node_modules/occt-import-js/test/testfiles/cax-if/source.txt',
  'public/fixtures/assembly-source.txt',
);
