import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'vw-ue-font-'));
  roots.push(root);
  await mkdir(join(root, 'Content'));
  return root;
}
async function api() {
  return import(
    /* @vite-ignore */ pathToFileURL(
      resolve('generators/scene-builder/src/engine-export/native/unreal/Scripts/prepare-font.mjs'),
    ).href
  );
}

it('rejects wrong offline font bytes without creating an installation', async () => {
  const root = await project();
  const font = join(root, 'wrong.otf');
  await writeFile(font, 'untrusted font');
  const { prepareFont } = await api();
  await expect(prepareFont(root, { fontSource: font })).rejects.toThrow(/SHA-256/);
  await expect(
    readFile(join(root, 'Content/VirtualWorldFonts/NotoSansCJKsc-Regular.otf')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does not overwrite existing unverified font files', async () => {
  const root = await project();
  const destination = join(root, 'Content/VirtualWorldFonts');
  await mkdir(destination);
  await writeFile(join(destination, 'keep.txt'), 'keep');
  const { prepareFont, verifyFont } = await api();
  await expect(prepareFont(root)).rejects.toThrow();
  expect(() => verifyFont(root)).toThrow();
  expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('keep');
});
it('rejects a font destination linked outside the exported project', async () => {
  const root = await project();
  const outside = await project();
  await symlink(
    join(outside, 'Content'),
    join(root, 'Content/VirtualWorldFonts'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const { prepareFont } = await api();
  await expect(prepareFont(root)).rejects.toThrow(/symlink|outside|directory/i);
});
