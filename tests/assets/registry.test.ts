import { expect, it } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Scene, Object3D } from 'three';
import { AssetRegistry, disposeObject } from '@virtualworld/asset-runtime';
import { node } from '@virtualworld/scene-schema';
it('caches a GLB once and creates independently editable path instances', async () => {
  let loads = 0;
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: '#ff0000' })));
  const registry = new AssetRegistry(async () => {
    loads++;
    return root;
  });
  const asset = {
    id: 'cube',
    name: 'Cube',
    type: 'glb' as const,
    url: 'assets/cube.glb',
    bytes: 0,
  };
  const spec = node('one', 'One', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', { assetNode: '0' });
  const [a, b] = await Promise.all([
    registry.loadInstance(asset, spec),
    registry.loadInstance(asset, { ...spec, id: 'two' }),
  ]);
  expect(loads).toBe(1);
  expect(a).not.toBe(b);
  expect((a as Mesh).geometry).not.toBe((b as Mesh).geometry);
  ((a as Mesh).material as MeshStandardMaterial).color.set('#00ff00');
  expect(((b as Mesh).material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  await expect(registry.loadInstance(asset, { ...spec, assetNode: '4' })).rejects.toThrow(/GLB/);
  disposeObject(a);
  disposeObject(b);
  registry.clear();
});
it('does not allocate a late Spark renderer after the owning runtime has been disposed', async () => {
  let finish!: (library: any) => void,
    allocations = 0;
  const pending = new Promise<any>((r) => {
    finish = r;
  });
  const registry = new AssetRegistry(undefined, () => pending),
    world = new Scene();
  const loading = registry.prepareSplats({} as any, world);
  registry.dispose();
  finish({
    SparkRenderer: class extends Object3D {
      constructor() {
        super();
        allocations++;
      }
      dispose() {}
    },
  });
  await loading;
  expect(allocations).toBe(0);
  expect(world.children).toHaveLength(0);
});
