import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bundle once per process; each export receives independent immutable bytes. */
let cached: Promise<Record<string, Uint8Array>> | undefined;
export function stepToolFiles(): Promise<Record<string, Uint8Array>> {
  return (cached ??= makeFiles().catch((error) => {
    cached = undefined;
    throw error;
  }));
}
async function makeFiles(): Promise<Record<string, Uint8Array>> {
  const prefix = 'Content/VirtualWorldTools/';
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../step-import-cli.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    write: false,
    external: ['occt-import-js', 'gltf-validator'],
    define: { 'import.meta.url': '__vwImportMetaUrl' },
    banner: { js: 'const __vwImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
    legalComments: 'inline',
  });
  const files: Record<string, Uint8Array> = {
    [`${prefix}step-import.cjs`]: result.outputFiles[0].contents,
  };
  const require = createRequire(import.meta.url);
  for (const pkg of ['occt-import-js', 'gltf-validator']) {
    const root = dirname(require.resolve(`${pkg}/package.json`));
    const visit = async (relative: string) => {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory() && entry.name === 'dist') await visit(path);
        else if (
          entry.isFile() &&
          (/\.(js|wasm)$/.test(entry.name) ||
            /^(package.json|LICENSE.*|COPYING.*)$/i.test(entry.name))
        )
          files[`${prefix}node_modules/${pkg}/${path}`] = await readFile(join(root, path));
      }
    };
    await visit('');
  }
  // Bundle notices for bundled dependencies, in addition to unmodified OCCT/validator licenses.
  for (const pkg of [
    'three',
    'zod',
    '@gltf-transform/core',
    '@gltf-transform/extensions',
    '@gltf-transform/functions',
    'property-graph',
    'ktx-parse',
  ]) {
    let root = dirname(require.resolve(pkg));
    // Package export maps do not necessarily expose package.json.
    for (let i = 0; i < 4; i++) {
      try {
        const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        if (metadata.name === pkg) break;
      } catch {
        /* Ascend to package root. */
      }
      root = dirname(root);
    }
    const license = (await readdir(root)).find((name) => /^LICENSE/i.test(name));
    if (!license) throw new Error(`Missing converter dependency license: ${pkg}`);
    files[`${prefix}licenses/${pkg.replaceAll('/', '-')}.txt`] = await readFile(
      join(root, license),
    );
  }
  return files;
}
