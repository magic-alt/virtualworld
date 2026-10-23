import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { emptyScene, assertScene } from '@virtualworld/scene-schema';
import { writeEngineExport } from '@virtualworld/scene-builder/engine-export';
import { importNativeCad } from '@virtualworld/scene-builder/native-cad';
import { prepareCadBundle } from '../../scripts/native-cad-bundle';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'native-cad-'));
  roots.push(root);
  const base = join(root, 'base');
  await mkdir(base);
  const files = new Map<string, Uint8Array>();
  await writeEngineExport({
    target: 'unreal',
    scenes: [{ ...emptyScene(), id: 'original', name: 'Original' }],
    entrySceneId: 'original',
    dataOnly: true,
    assetBytes: () => {
      throw new Error('Unexpected asset');
    },
    primitiveFactory: () => {
      throw new Error('Unexpected primitive');
    },
    emit: (p, b) => files.set(p, b),
  });
  for (const [p, b] of files) {
    await mkdir(join(base, p, '..'), { recursive: true });
    await writeFile(join(base, p), b);
  }
  return { root, catalog: join(base, 'Content/VirtualWorldData') };
}
it('converts a real millimetre STEP from a Unicode path to validated metre geometry and retains source/catalog', async () => {
  const { root, catalog } = await setup();
  const input = join(root, '外部 模型.STEP');
  await cp('public/fixtures/cube-mm.step', input);
  const before = await readFile(join(catalog, 'engine-manifest.json'));
  const output = join(root, 'import');
  const result = await importNativeCad({ input, output, catalog });
  const scene = assertScene(JSON.parse(await readFile(join(output, 'scene.json'), 'utf8')));
  expect(scene.id).toBe(result.sceneId);
  expect(scene.mode).toBe('industrial');
  expect(scene.nodes.length).toBeGreaterThan(0);
  const data = JSON.parse(
    await readFile(join(result.dataDirectory, 'engine-manifest.json'), 'utf8'),
  );
  expect(data.scenes.map((s: any) => s.id)).toEqual(['original', result.sceneId]);
  const asset = data.assets.find((a: any) => a.id === result.modelId);
  const bytes = await readFile(join(result.dataDirectory, asset.path));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  const doc = await new NodeIO().readBinary(bytes);
  expect(doc.getRoot().listMeshes().length).toBeGreaterThan(0);
  expect(result.size).toEqual(expect.arrayContaining([expect.closeTo(0.01, 5)]));
  expect(result.size.every((v) => Math.abs(v - 0.01) < 1e-5)).toBe(true);
  expect(await readFile(join(output, result.source))).toEqual(await readFile(input));
  const receipt = JSON.parse(await readFile(join(output, 'manifests/import.json'), 'utf8'));
  expect(receipt.validation.errors).toBe(0);
  expect(receipt.validation.warnings).toBeGreaterThanOrEqual(0);
  expect(receipt.validation.messages).toBeInstanceOf(Array);
  expect(await readFile(join(catalog, 'engine-manifest.json'))).toEqual(before);
});
it('retains multiple named parts in a real STP assembly and refuses replacing an import directory', async () => {
  const { root, catalog } = await setup();
  const output = join(root, 'import');
  const result = await importNativeCad({ input: 'public/fixtures/assembly.step', output, catalog });
  const doc = await new NodeIO().readBinary(
    await readFile(join(output, 'optimized', `${result.modelId}.glb`)),
  );
  expect(doc.getRoot().listMeshes().length).toBeGreaterThan(1);
  expect(
    doc
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh() && n.getName()).length,
  ).toBeGreaterThan(1);
  await expect(
    importNativeCad({ input: 'public/fixtures/assembly.step', output, catalog }),
  ).rejects.toThrow(/exist/i);
});
it('rejects invalid and empty CAD without publishing output or modifying the catalog', async () => {
  const { root, catalog } = await setup();
  const before = await readFile(join(catalog, 'engine-manifest.json'));
  for (const [name, content] of [
    ['bad.step', 'not STEP'],
    ['empty.stp', ''],
  ]) {
    const input = join(root, name);
    await writeFile(input, content);
    await expect(
      importNativeCad({ input, output: join(root, name + '-out'), catalog }),
    ).rejects.toThrow();
    await expect(readdir(join(root, name + '-out'))).rejects.toThrow();
  }
  expect(await readFile(join(catalog, 'engine-manifest.json'))).toEqual(before);
});
it('runs the bundled converter outside the repository without npm or a service', async () => {
  const { root, catalog } = await setup();
  const bundle = join(root, '工具 包');
  await prepareCadBundle(bundle);
  const request = join(root, 'request.json');
  const output = join(root, 'converted');
  await writeFile(
    request,
    JSON.stringify({
      input: join(process.cwd(), 'public/fixtures/cube-mm.step'),
      output,
      catalog,
      result: join(root, 'result.json'),
    }),
  );
  execFileSync(process.execPath, [join(bundle, 'import-cad.mjs'), '--request', request], {
    cwd: root,
    timeout: 60000,
    env: { PATH: '/usr/bin:/bin' },
  });
  expect(JSON.parse(await readFile(join(root, 'result.json'), 'utf8')).success).toBe(true);
}, 60000);
