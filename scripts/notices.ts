import { readFile, writeFile } from 'node:fs/promises';
const packages = [
  ['three', 'LICENSE', 'https://github.com/mrdoob/three.js'],
  ['@sparkjsdev/spark', 'LICENSE', 'https://github.com/sparkjsdev/spark'],
  [
    '@dimforge/rapier3d-compat',
    '../../../licenses/rapier-Apache-2.0.txt',
    'https://github.com/dimforge/rapier.js',
  ],
  ['react', 'LICENSE', 'https://github.com/facebook/react'],
  ['react-dom', 'LICENSE', 'https://github.com/facebook/react'],
  ['lucide-react', 'LICENSE', 'https://github.com/lucide-icons/lucide'],
  ['fflate', 'LICENSE', 'https://github.com/101arrowz/fflate'],
  ['zod', 'LICENSE', 'https://github.com/colinhacks/zod'],
  ['occt-import-js', 'LICENSE.md', 'https://github.com/kovacsv/occt-import-js'],
];
let text =
  '# Third-party notices\n\nGenerated from the exact installed package versions. License texts below are retained verbatim. No changes were made to vendor sources.\n\nOriginal mechanical/story geometry and procedural Gaussian cloud were authored for VirtualWorld Studio. STEP cubes are test fixtures from occt-import-js, distributed with that upstream package. CAD WASM and fixtures are prepared locally from npm; the static player excludes the CAD parser.\n\n';
for (const [name, file, url] of packages) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  const license = await readFile(
    name === '@dimforge/rapier3d-compat'
      ? 'licenses/rapier-Apache-2.0.txt'
      : `node_modules/${name}/${file}`,
    'utf8',
  );
  text += `## ${name} ${pkg.version}\n\nLicense: ${pkg.license}\n\nSource: ${url}\n\n\`\`\`text\n${license.trimEnd()}\n\`\`\`\n\n`;
}
text +=
  '## OCCT source and replacement\n\nocct-import-js uses Open CASCADE Technology. Its original build configuration, C++ importer source, dependency submodule and Windows build scripts are available at https://github.com/kovacsv/occt-import-js. The npm package is pinned to 0.0.23 and includes importer source/build scripts. Local vendor copies remain unmodified and replaceable at public/cad/occt-import-js.js and public/cad/occt-import-js.wasm. LGPL-2.1 license text is reproduced above.\n';
await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log('Third-party notices generated.');
