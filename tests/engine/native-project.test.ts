import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareNativeProject } from '../../scripts/native-project';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'vw-native-project-'));
  roots.push(root);
  return root;
}

it('refuses to overwrite an existing native project before exporting', async () => {
  const root = await workspace();
  const out = join(root, 'existing');
  await mkdir(out);
  await writeFile(join(out, 'keep.txt'), 'user project');
  await expect(
    prepareNativeProject({
      target: 'unity',
      sceneId: 'demo-harmonic-joint',
      out,
      projectRoot: resolve('.'),
    }),
  ).rejects.toThrow(/exists|存在/);
  expect(await readFile(join(out, 'keep.txt'), 'utf8')).toBe('user project');
});

it('creates an offline Unity source project with all authored Prince chapters and canonical actor assets', async () => {
  const root = await workspace();
  const out = join(root, 'prince');
  const result = await prepareNativeProject({
    target: 'unity',
    sceneId: 'little-prince-b612',
    out,
    projectRoot: resolve('.'),
  });
  expect(result.projectPath).toBe(out);
  const manifestPath = join(out, 'Assets/VirtualWorldExport/engine-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  expect(manifest.entrySceneId).toBe('little-prince-b612');
  expect(manifest.scenes.map((scene: { id: string }) => scene.id)).toEqual([
    'little-prince-desert',
    'little-prince-b612',
    'little-prince-earth',
  ]);
  expect(manifest.campaign.chapters[1].requires).toEqual(['little-prince-desert']);
  for (const scene of manifest.scenes) {
    const model = manifest.assets.find((asset: { id: string }) => asset.id === scene.actorModel);
    expect(model).toBeDefined();
    expect((await stat(join(out, 'Assets/VirtualWorldExport', model.path))).size).toBe(model.bytes);
  }
  expect(
    JSON.parse(await readFile(join(out, 'Packages/manifest.json'), 'utf8')).dependencies[
      'com.unity.cloud.gltfast'
    ],
  ).toBe('6.14.1');
  expect(await readFile(join(out, 'Assets/VirtualWorldExport/ATTRIBUTION.txt'), 'utf8')).toContain(
    'Saint-Exupery',
  );
});

it('rejects unknown scenes without leaving a partial output', async () => {
  const root = await workspace();
  const out = join(root, 'missing');
  await expect(
    prepareNativeProject({
      target: 'unity',
      sceneId: 'missing-world',
      out,
      projectRoot: resolve('.'),
    }),
  ).rejects.toThrow(/Unknown|不存在/);
  await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
});
