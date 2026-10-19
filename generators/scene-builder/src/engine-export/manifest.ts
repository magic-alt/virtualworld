import type { SceneNode, SceneSpec } from '@virtualworld/scene-schema';
import { Euler, Quaternion } from 'three';
export interface CompatibilityFinding {
  code: string;
  feature: string;
  severity: 'warning';
  sceneId: string;
  nodeId?: string;
  assetId?: string;
  message: string;
}
export interface CanonicalAsset {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  source?: { sceneId: string; assetId: string; url: string; assetNode?: string };
  sources: { sceneId: string; assetId: string; url: string; assetNode?: string }[];
}
export function nativeNode(node: SceneNode, scene: SceneSpec, model?: string) {
  const rotation = [...node.rotation];
  if (node.joint) rotation[{ x: 0, y: 1, z: 2 }[node.joint.axis]] += node.joint.value;
  let effectiveVisible = node.visible;
  let parent = node.parentId;
  while (parent) {
    const ancestor = scene.nodes.find((n) => n.id === parent)!;
    effectiveVisible &&= ancestor.visible;
    parent = ancestor.parentId;
  }
  return {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    translation: node.position,
    rotation: new Quaternion()
      .setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ'))
      .toArray(),
    scale: node.scale,
    visible: node.visible,
    effectiveVisible,
    model,
    collider: node.collider,
    metadata: node,
    metadataJson: JSON.stringify(node),
  };
}
export function findings(scene: SceneSpec): CompatibilityFinding[] {
  const result: CompatibilityFinding[] = [];
  const add = (code: string, feature: string, message: string, node?: SceneNode) =>
    result.push({
      code,
      feature,
      severity: 'warning',
      sceneId: scene.id,
      ...(node ? { nodeId: node.id, assetId: node.assetId } : {}),
      message,
    });
  if (scene.tasks.length || scene.actor || scene.campaign)
    add(
      'GAMEPLAY_UNMAPPED',
      'scene gameplay',
      'Story, campaign progression and actor control remain metadata.',
    );
  if (scene.navigation?.kind === 'sphere')
    add(
      'SPHERICAL_NAVIGATION_UNMAPPED',
      'spherical navigation',
      'Native adapter uses authored coordinates; spherical locomotion is not implemented.',
    );
  if (scene.mechanism)
    add(
      'HARMONIC_CONTROL_UNMAPPED',
      'harmonic mechanism',
      'Harmonic control and deformation are not executed.',
    );
  if (scene.environment.fog)
    add(
      'FOG_APPROXIMATION',
      'environment fog',
      'Browser exponential fog is not reproduced exactly.',
    );
  for (const node of scene.nodes) {
    if (node.interaction || node.joint)
      add(
        'GAMEPLAY_UNMAPPED',
        'node gameplay',
        'Interaction and joint controls remain metadata; joint value is baked into initial rotation.',
        node,
      );
    if (node.animation)
      add(
        'ANIMATION_PLAYBACK_UNMAPPED',
        'animation playback',
        'Whole GLB clips are retained; requested playback is not started.',
        node,
      );
    if (node.kind === 'splat')
      add('SPLAT_UNSUPPORTED', 'splat', 'Splat rendering is not implemented.', node);
    if (node.kind === 'light')
      add(
        'LIGHT_UNMAPPED',
        'node light',
        'Authored light node has no intensity/type declaration; environment lighting is mapped.',
        node,
      );
    if (node.shape === 'arch')
      add(
        'MATERIAL_APPROXIMATION',
        'material',
        'Unlit/depth-write browser material behavior is approximated by glTF PBR.',
        node,
      );
    if (node.collider) {
      let cursor: SceneNode | undefined = node;
      let nonuniform = false;
      while (cursor) {
        if (new Set(cursor.scale).size > 1) nonuniform = true;
        cursor = scene.nodes.find((n) => n.id === cursor?.parentId);
      }
      if (nonuniform)
        add(
          'NONUNIFORM_COLLIDER_SCALE',
          'collider scale',
          'Nonuniform ancestral scale can create shear and engine-specific collider approximation.',
          node,
        );
      if (node.animation || node.assetId)
        add(
          'ANIMATED_COLLISION_LIMITATION',
          'mesh collision',
          'Colliders are static initial geometry; animation/deformation does not update collision.',
          node,
        );
    }
  }
  return result;
}
