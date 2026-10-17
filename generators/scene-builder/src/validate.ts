import { readFile } from 'node:fs/promises';
import { assertScene, type SceneSpec } from '@virtualworld/scene-schema';
import { inside } from './io';
import { validateGlb } from './pipeline';
import { readUpload } from './asset-library';
import { join } from 'node:path';
export async function validateWorldAssets(scene: SceneSpec, root: string) {
  assertScene(scene);
  for (const asset of scene.assets) {
    const path = asset.url.startsWith('/assets/optimized/')
      ? inside(root, asset.url.slice(1))
      : asset.url.startsWith('/fixtures/')
        ? inside(root, `public${asset.url}`)
        : asset.url.startsWith('/api/assets/')
          ? inside(root, `data/assets/${asset.url.slice(12)}`)
          : null;
    if (!path) throw new Error(`Cannot validate asset path: ${asset.url}`);
    const bytes = asset.url.startsWith('/api/assets/')
      ? await readUpload(join(root, 'assets'), join(root, 'data', 'assets'), asset.url.slice(12))
      : await readFile(path);
    if (asset.bytes && asset.bytes !== bytes.length)
      throw new Error(`Asset size mismatch: ${asset.id}`);
    if (asset.type === 'glb') await validateGlb(bytes);
    else if (asset.url.endsWith('.ply') && !bytes.subarray(0, 4096).toString().includes('f_dc_0'))
      throw new Error('PLY is not a Gaussian Splat');
  }
  return { valid: true };
}
