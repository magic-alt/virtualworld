import type { SceneNode, SceneSpec } from '@virtualworld/scene-schema';
import { Euler, Quaternion } from 'three';
export type EngineTarget = 'unity' | 'unreal' | 'godot';
export function nativeRuntime(target: EngineTarget) {
  if (target === 'godot') return undefined;
  return {
    version: 1 as const,
    implementation: 'native' as const,
    validation: 'requires-engine' as const,
    features: [
      'scene-selection',
      'environment',
      'actor-control',
      'actor-animation',
      'plane-navigation',
      'spherical-navigation',
      'story',
      'campaign',
      'harmonic-control',
      'node-animation',
    ],
  };
}
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
export function findings(scene: SceneSpec, target: EngineTarget = 'godot'): CompatibilityFinding[] {
  const result: CompatibilityFinding[] = [];
  const native = target === 'unity' || target === 'unreal';
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
      native ? 'NATIVE_RUNTIME_REQUIRES_VALIDATION' : 'GAMEPLAY_UNMAPPED',
      'scene gameplay',
      native
        ? 'Native runtime source implements actor control, story and campaign progression; engine compilation and gameplay validation are still required.'
        : 'Story, campaign progression and actor control remain metadata.',
    );
  if (scene.navigation?.kind === 'sphere')
    add(
      native ? 'NATIVE_RUNTIME_REQUIRES_VALIDATION' : 'SPHERICAL_NAVIGATION_UNMAPPED',
      'spherical navigation',
      native
        ? 'Native runtime source constrains actor movement to the authored sphere; validate collision, orientation and camera behavior in the target engine.'
        : 'Native adapter uses authored coordinates; spherical locomotion is not implemented.',
    );
  if (target === 'unreal' && scene.actor)
    add(
      'CHARACTER_JUMP_UNMAPPED',
      'actor jump',
      'The Unreal source controller supports grounded plane/sphere movement; character jump and airborne gravity are not implemented.',
    );
  if (scene.mechanism)
    add(
      native ? 'NATIVE_RUNTIME_REQUIRES_VALIDATION' : 'HARMONIC_CONTROL_UNMAPPED',
      'harmonic mechanism',
      native
        ? 'Native runtime source implements signed transmission, named morph deformation and mechanism controls; validate mesh imports and motion in the target engine.'
        : 'Harmonic control and deformation are not executed.',
    );
  if (native)
    add(
      'NATIVE_RUNTIME_REQUIRES_VALIDATION',
      'environment',
      'Native camera and environment setup is included; lighting, materials and rendering require validation in the target engine.',
    );
  if (scene.environment.fog)
    add(
      'FOG_APPROXIMATION',
      'environment fog',
      'Browser exponential fog is not reproduced exactly.',
    );
  for (const node of scene.nodes) {
    if (!native && (node.interaction || node.joint))
      add(
        'GAMEPLAY_UNMAPPED',
        'node gameplay',
        'Interaction and joint controls remain metadata; joint value is baked into initial rotation.',
        node,
      );
    if (native && node.interaction)
      add(
        'NATIVE_RUNTIME_REQUIRES_VALIDATION',
        'node interaction',
        'Native runtime source implements interaction prerequisites, flags and dialogue choices; validate the authored interaction in the target engine.',
        node,
      );
    if (native && node.joint)
      add(
        'GAMEPLAY_UNMAPPED',
        'joint control',
        'Generic joint controls remain metadata; joint value is baked into the initial rotation. Harmonic mechanism controls are handled separately.',
        node,
      );
    if (node.animation) {
      const playback = native && node.shape === 'glb' && node.assetNode === undefined;
      add(
        playback ? 'NATIVE_RUNTIME_REQUIRES_VALIDATION' : 'ANIMATION_PLAYBACK_UNMAPPED',
        'animation playback',
        playback
          ? 'Native runtime source starts the requested whole-GLB clip with authored loop and speed; clip import and playback require validation in the target engine.'
          : 'Whole GLB clips are retained; general requested node playback is not mapped by this adapter.',
        node,
      );
    }
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
