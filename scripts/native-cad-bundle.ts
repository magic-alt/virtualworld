import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export async function prepareCadBundle(directory: string) {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL('./native-cad-worker.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: join(directory, 'import-cad.mjs'),
    banner: {
      js: 'import {createRequire as __createRequire} from "node:module"; const require = __createRequire(import.meta.url);',
    },
    logLevel: 'silent',
  });
  await cp(
    dirname(require.resolve('gltf-validator/package.json')),
    join(directory, 'node_modules/gltf-validator'),
    { recursive: true },
  );
  const occt = dirname(require.resolve('occt-import-js'));
  await copyFile(join(occt, 'occt-import-js.js'), join(directory, 'occt-import-js.cjs'));
  await copyFile(join(occt, 'occt-import-js.wasm'), join(directory, 'occt-import-js.wasm'));
  for (const file of ['license.occt-import-js.txt', 'license.occt.txt'])
    await copyFile(join(occt, file), join(directory, file));
  await copyFile(join(occt, '../LICENSE.md'), join(directory, 'OCCT-LICENSE.txt'));
  await copyFile(
    fileURLToPath(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)),
    join(directory, 'THIRD_PARTY_NOTICES.md'),
  );
}
