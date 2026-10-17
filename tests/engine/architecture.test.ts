import { expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
async function sources(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(p)));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
it('keeps runtime dependency direction independent of generators and apps', async () => {
  for (const name of ['scene-schema', 'engine', 'interaction', 'asset-runtime']) {
    const pkg = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
    expect(
      Object.keys(pkg.dependencies || {}).filter((p) =>
        /planner|scene-builder|tripo|blender/.test(p),
      ),
    ).toEqual([]);
    for (const file of await sources(`packages/${name}/src`)) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(
        /(?:from\s*|import\s*\()\s*['"][^'"]*(?:generators\/|apps\/|@virtualworld\/(?:planner|scene-builder|tripo|blender))/,
      );
      if (name === 'scene-schema')
        expect(text, file).not.toMatch(/from\s*['"](?:three|react|node:)/);
      if (name === 'interaction' || name === 'asset-runtime')
        expect(text, file).not.toContain('@virtualworld/engine');
    }
  }
});
it('uses public workspace imports with declared package dependencies', async () => {
  for (const family of ['apps', 'packages', 'generators'])
    for (const entry of await readdir(family, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = join(family, entry.name),
        pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      for (const file of await sources(root)) {
        const text = await readFile(file, 'utf8');
        expect(text, file).not.toMatch(
          /(?:from\s*|import\s*\()\s*['"]\.\.[^'"]*(?:packages|generators|apps)\/[^'"]*\/src\//,
        );
        for (const match of text.matchAll(
          /(?:from\s*|import\s*\()\s*['"](@virtualworld\/[^'"/]+)/g,
        )) {
          expect(pkg.dependencies?.[match[1]], `${file} uses undeclared ${match[1]}`).toBeTruthy();
        }
      }
    }
});
