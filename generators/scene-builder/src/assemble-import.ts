import * as THREE from 'three';
import {
  node,
  type SceneAsset,
  type SceneNode,
  type Vector3Tuple,
  type SceneCommand,
} from '@virtualworld/scene-schema';
export function groupCommands(
  group: THREE.Object3D,
  asset: SceneAsset,
  name: string,
): SceneCommand[] {
  const prefix = `import-${crypto.randomUUID().slice(0, 8)}`;
  const commands: SceneCommand[] = [{ type: 'addAsset', asset }];
  // SceneSpec's decomposed parts represent static, positive-scale triangle meshes.
  // Keep every other glTF hierarchy intact so bones, tracks and object classes
  // remain authoritative in the asset instead of being reconstructed lossily.
  let preserveRoot = false;
  group.traverse((object) => {
    if (
      object.animations.length ||
      !['Group', 'Object3D', 'Mesh'].includes(object.type) ||
      object.scale.toArray().some((value) => value <= 0) ||
      !object.matrixAutoUpdate ||
      object.rotation.order !== 'XYZ'
    )
      preserveRoot = true;
  });
  if (preserveRoot) {
    const clip = group.animations.find(
      (animation) => animation.name.length > 0 && animation.name.length <= 100,
    );
    commands.push({
      type: 'addNode',
      node: node(prefix, name, 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
        assetId: asset.id,
        materialOverride: false,
        ...(clip ? { animation: { clip: clip.name, loop: true, speed: 1 } } : {}),
      }),
    });
    return commands;
  }
  function visit(object: THREE.Object3D, path: string, parentId?: string) {
    const id = path ? `${prefix}-${path.replaceAll('.', '-')}` : prefix;
    const mesh = object instanceof THREE.Mesh;
    const material = mesh
      ? ((Array.isArray(object.material)
          ? object.material[0]
          : object.material) as THREE.MeshStandardMaterial)
      : undefined;
    const color = material?.color ? `#${material.color.getHexString()}` : '#ffffff';
    const n: SceneNode = node(
      id,
      object.name || (path ? '零件' : name),
      mesh ? 'glb' : undefined,
      object.position.toArray() as Vector3Tuple,
      [1, 1, 1],
      color,
      {
        kind: mesh ? 'mesh' : 'group',
        visible: object.visible,
        parentId,
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray() as Vector3Tuple,
        ...(mesh ? { assetId: asset.id, assetNode: path, materialOverride: false } : {}),
        explode: mesh
          ? [object.position.x === 0 ? 0.5 : Math.sign(object.position.x), 0.5, 0]
          : undefined,
      },
    );
    commands.push({ type: 'addNode', node: n });
    object.children.forEach((child, i) => visit(child, path ? `${path}.${i}` : `${i}`, id));
  }
  visit(group, '');
  return commands;
}
