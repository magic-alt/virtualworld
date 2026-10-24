import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { assertScene } from '@virtualworld/scene-schema';
import { convertStep } from '../../generators/scene-builder/src/step-import';
import { stepToolFiles } from '../../generators/scene-builder/src/engine-export/step-tools';

const roots: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'vw-step-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

it('converts a real millimetre STEP to a validated single module with metric geometry', async () => {
  const root = await temp();
  await convertStep('public/fixtures/cube-mm.step', join(root, 'import'));
  const scene = assertScene(JSON.parse(await readFile(join(root, 'import/scene.json'), 'utf8')));
  expect(scene.nodes).toHaveLength(1);
  expect(scene.mechanism).toBeUndefined();
  const manifest = JSON.parse(await readFile(join(root, 'import/engine-manifest.json'), 'utf8'));
  const doc = await new NodeIO().read(join(root, 'import', manifest.assets[0].path));
  const positions = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives().map((p) => p.getAttribute('POSITION')!));
  expect(positions.length).toBeGreaterThan(0);
  const values = Array.from(positions[0].getArray()!);
  const xs = values.filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.01, 5);
  expect(manifest.scenes[0].metadataJson).toBe(JSON.stringify(scene));
  expect(JSON.parse(await readFile(join(root, 'import/validation.json'), 'utf8')).errors).toBe(0);
  expect(
    (await readFile(join(root, 'import/source/cube-mm.step'))).equals(
      await readFile('public/fixtures/cube-mm.step'),
    ),
  ).toBe(true);
});

it('retains assembly parts, names and color without adding multiple scene modules', async () => {
  const root = await temp();
  await convertStep('public/fixtures/assembly.step', join(root, 'assembly'));
  const manifest = JSON.parse(await readFile(join(root, 'assembly/engine-manifest.json'), 'utf8'));
  const doc = await new NodeIO().read(join(root, 'assembly', manifest.assets[0].path));
  expect(doc.getRoot().listMeshes().length).toBeGreaterThan(1);
  expect(
    doc
      .getRoot()
      .listNodes()
      .some((n) => n.getName().length > 0),
  ).toBe(true);
  expect(
    doc
      .getRoot()
      .listMaterials()
      .some((m) =>
        m
          .getBaseColorFactor()
          .slice(0, 3)
          .some((v) => v !== 1),
      ),
  ).toBe(true);
  expect(manifest.scenes[0].nodes).toHaveLength(1);
});

it('rejects empty and malformed input and never overwrites a retained import', async () => {
  const root = await temp();
  const input = join(root, 'bad.stp');
  await writeFile(input, '');
  await expect(convertStep(input, join(root, 'empty'))).rejects.toThrow(/empty|空/i);
  await writeFile(input, 'not a STEP model');
  await expect(convertStep(input, join(root, 'bad'))).rejects.toThrow(/STEP|geometry/i);
  const oversized = await open(input, 'w');
  try {
    await oversized.truncate(100 * 1024 * 1024 + 1);
  } finally {
    await oversized.close();
  }
  await expect(convertStep(input, join(root, 'oversized'))).rejects.toThrow(/100 MiB/);
  const occupied = join(root, 'occupied');
  await mkdir(occupied);
  await writeFile(join(occupied, 'keep'), 'retained');
  await expect(convertStep(input, occupied)).rejects.toThrow(/exist|occupied/i);
  expect(await readFile(join(occupied, 'keep'), 'utf8')).toBe('retained');
});

it('runs the exported converter away from the repository with Unicode spaced paths', async () => {
  const root = await temp();
  const files = await stepToolFiles();
  expect(
    new TextDecoder().decode(files['Content/VirtualWorldTools/licenses/property-graph.txt']),
  ).toContain('Copyright');
  expect(
    new TextDecoder().decode(files['Content/VirtualWorldTools/licenses/ktx-parse.txt']),
  ).toContain('Copyright');
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  const source = join(root, '其他 模组.stp');
  await writeFile(source, await readFile('public/fixtures/cube-mm.step'));
  const run = spawnSync(
    process.execPath,
    [join(root, 'Content/VirtualWorldTools/step-import.cjs'), source, join(root, 'new model')],
    { cwd: root, encoding: 'utf8', timeout: 90000 },
  );
  expect(run.stderr).toBe('');
  expect(run.status, run.stdout).toBe(0);
  expect(
    assertScene(JSON.parse(await readFile(join(root, 'new model/scene.json'), 'utf8'))).nodes,
  ).toHaveLength(1);
}, 120000);
