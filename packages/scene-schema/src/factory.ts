import type { SceneSpec, SceneNode, Vector3Tuple } from './schema';
export function emptyScene(mode: SceneSpec['mode'] = 'industrial'): SceneSpec {
  return {
    version: 1,
    id: 'untitled',
    name: '未命名项目',
    description: '',
    mode,
    revision: 0,
    assets: [],
    nodes: [],
    tasks: [],
    environment: { background: '#101722', lightIntensity: 3, ambientIntensity: 1.5 },
    camera: { position: [3, 2.5, 3], target: [0, 0, 0] },
    spawn: [0, 1, 3],
  };
}
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
