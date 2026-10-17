import type { Object3D } from 'three';
import type { SceneNode, Vector3Tuple } from '@virtualworld/scene-schema';
export function captureTransform(
  node: SceneNode,
  object: Object3D,
  explosion: number,
): Partial<SceneNode> {
  const position = object.position
    .toArray()
    .map((v, i) => v - (node.explode?.[i] || 0) * explosion) as Vector3Tuple;
  const rotation: Vector3Tuple = [object.rotation.x, object.rotation.y, object.rotation.z];
  if (node.joint) rotation[{ x: 0, y: 1, z: 2 }[node.joint.axis]] -= node.joint.value;
  return { position, rotation, scale: object.scale.toArray() as Vector3Tuple };
}
