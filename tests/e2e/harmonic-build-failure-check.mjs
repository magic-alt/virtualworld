/** Real Blender rejection must preserve the last approved runtime asset/manifest. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const sentinel = Buffer.from('previously-validated-artifact');
const verifyExisting = process.argv[2] === '--verify-existing';
mkdirSync('output', { recursive: true });
const root = verifyExisting
  ? resolve(process.argv[3])
  : mkdtempSync(resolve('output/h100-build-failure-'));
const files = [
  'assets/optimized/showcase/harmonic-joint.glb',
  'assets/manifests/showcase/harmonic-joint.json',
];
if (!verifyExisting) {
  const source = join(root, 'generators/blender/harmonic');
  mkdirSync(source, { recursive: true });
  for (const name of ['build.py', 'assembly.py', 'exterior.py', 'recipe.json'])
    copyFileSync(resolve('generators/blender/harmonic', name), join(source, name));
  const recipe = JSON.parse(readFileSync(join(source, 'recipe.json'), 'utf8'));
  recipe.allowedContactPairs = [];
  writeFileSync(join(source, 'recipe.json'), JSON.stringify(recipe));
  for (const name of files) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, sentinel);
  }
  const result = spawnSync(
    process.env.BLENDER_PATH || 'E:/Software/Blender Foundation/Blender 5.2/blender.exe',
    ['--background', '--python-exit-code', '1', '--python', join(source, 'build.py')],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  writeFileSync(join(root, 'blender.log'), String(result.stdout) + String(result.stderr));
  if (result.error) throw result.error;
  assert.equal(result.status, 1, 'fixture must be rejected for unexpected contacts');
}
for (const name of files)
  assert.ok(readFileSync(join(root, name)).equals(sentinel), `failed generation overwrote ${name}`);
const report = JSON.parse(readFileSync(join(root, 'output/harmonic-build-failure.json'), 'utf8'));
assert.ok(report.interference.unexpected.length > 0);
writeFileSync(
  'output/h100-build-failure-receipt.json',
  JSON.stringify(
    {
      fixture: root,
      checks: [
        'real Blender rejected unapproved contacts',
        'approved optimized GLB preserved',
        'approved manifest preserved',
        'failed audit retained separately',
      ],
    },
    null,
    2,
  ),
);
console.log(
  'PASS real Blender rejection preserves approved artifacts and retains failed diagnostics',
);
