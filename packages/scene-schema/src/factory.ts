import type { SceneSpec, SceneNode, Vector3Tuple } from './schema';
export function node(
  id: string,
  name: string,
  shape: SceneNode['shape'],
  position: Vector3Tuple,
  size: Vector3Tuple,
  color: string,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name,
    kind: 'mesh',
    shape,
    position,
    size,
    color,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    ...extra,
  };
}
