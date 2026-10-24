import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const helper = () =>
  import(
    new URL(
      '../../generators/scene-builder/src/engine-export/native/unreal/Scripts/package-runtime.mjs',
      import.meta.url,
    ).href
  );
it('builds host-native archive options and rejects unsupported cross-target or configuration', async () => {
  const { packageOptions } = await helper();
  expect(packageOptions([], 'darwin', '/project')).toMatchObject({
    platform: 'Mac',
    configuration: 'Development',
    archive: '/project/Packaged/Mac/Development',
  });
  expect(
    packageOptions(
      ['--platform', 'Win64', '--configuration', 'Shipping', '--output', 'release'],
      'win32',
      '/project',
    ),
  ).toMatchObject({ platform: 'Win64', configuration: 'Shipping', archive: '/project/release' });
  for (const args of [
    ['--platform', 'Win64'],
    ['--configuration', 'Debug'],
    ['--output'],
    ['--output', 'one', '--output', 'two'],
  ])
    expect(() => packageOptions(args, 'darwin', '/project')).toThrow();
});
it('includes only the trusted installed host runtime and license when the CAD helper exists', async () => {
  const { preparePackageRuntime } = await helper(),
    root = await mkdtemp(join(tmpdir(), 'vw-package-'));
  roots.push(root);
  const runtime = join(root, 'installed', 'bin', 'node');
  await mkdir(join(root, 'installed', 'bin'), { recursive: true });
  await writeFile(runtime, 'host runtime fixture');
  await writeFile(join(root, 'installed', 'LICENSE'), 'Node fixture license');
  expect(
    preparePackageRuntime(root, { execPath: runtime, platform: 'darwin', nodeVersion: '24.15.0' }),
  ).toMatchObject({ included: false });
  await mkdir(join(root, 'Content/VirtualWorldTools/Cad'), { recursive: true });
  await writeFile(join(root, 'Content/VirtualWorldTools/Cad/import-cad.mjs'), 'CAD helper fixture');
  const result = preparePackageRuntime(root, {
    execPath: runtime,
    platform: 'darwin',
    nodeVersion: '24.15.0',
  });
  expect(result).toMatchObject({ included: true, version: '24.15.0' });
  expect(await readFile(join(root, 'Content/VirtualWorldTools/Node/node'), 'utf8')).toBe(
    'host runtime fixture',
  );
  expect(await readFile(join(root, 'Content/VirtualWorldTools/Node/LICENSE'), 'utf8')).toBe(
    'Node fixture license',
  );
  expect(
    JSON.parse(await readFile(join(root, 'Content/VirtualWorldTools/Node/runtime.json'), 'utf8')),
  ).toMatchObject({
    platform: 'darwin',
    version: '24.15.0',
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(() =>
    preparePackageRuntime(root, { execPath: runtime, platform: 'darwin', nodeVersion: '20.0.0' }),
  ).toThrow(/24/);
});
