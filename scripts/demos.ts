import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const validator = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(
    bytes: Uint8Array,
    options: { uri: string; maxIssues: number },
  ): Promise<{ issues: { numErrors: number; numWarnings: number } }>;
};
import { listWorlds, listCampaigns } from '@virtualworld/scene-builder/io';

const blender =
  process.env.BLENDER_PATH || 'E:/Software/Blender Foundation/Blender 5.2/blender.exe';
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: resolve('.') });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
};
if (process.argv[2] === 'build') {
  const target = process.argv[3] || 'all';
  if (!['all', 'prince', 'harmonic'].includes(target))
    throw new Error('Choose all, prince or harmonic');
  if (target !== 'harmonic') run(process.execPath, ['generators/blender/prince/build.mjs']);
  if (target !== 'prince') {
    run(blender, [
      '--background',
      '--python-exit-code',
      '1',
      '--python',
      'generators/blender/harmonic/build.py',
    ]);
    run(process.execPath, ['generators/blender/harmonic/finalize.mjs']);
  }
}
const worlds = (await listWorlds(resolve('worlds'))).filter(
  (w) => w.scene.campaign || w.scene.mechanism,
);
const unique = new Map<
  string,
  { bytes: number; sha256: string; errors: number; warnings: number }
>();
for (const { scene } of worlds) {
  let total = 0;
  for (const asset of scene.assets) {
    if (!asset.url.startsWith('/assets/optimized/showcase/'))
      throw new Error(`Unexpected showcase URL: ${asset.url}`);
    if (!unique.has(asset.url)) {
      const bytes = await readFile(resolve(asset.url.slice(1)));
      const report = await validator.validateBytes(new Uint8Array(bytes), {
        uri: asset.url,
        maxIssues: 100,
      });
      if (report.issues.numErrors)
        throw new Error(`${asset.url}: ${JSON.stringify(report.issues)}`);
      unique.set(asset.url, {
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        errors: report.issues.numErrors,
        warnings: report.issues.numWarnings,
      });
    }
    total += unique.get(asset.url)!.bytes;
  }
  if (total > 15 * 1024 * 1024) throw new Error(`${scene.id} exceeds 15 MiB initial asset budget`);
  console.log(`${scene.id}: ${(total / 1048576).toFixed(2)} MiB`);
}
if (
  worlds.length !== 4 ||
  !(await listCampaigns(resolve('worlds'))).some((c) => c.id === 'little-prince')
)
  throw new Error('Expected harmonic joint and all three Prince chapters');
console.log(JSON.stringify(Object.fromEntries(unique), null, 2));
