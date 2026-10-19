import { createHash } from 'node:crypto';
import { assertScene, type SceneSpec, type SceneNode } from '@virtualworld/scene-schema';
import type { Object3D } from 'three';
import { importedModel, proceduralModel } from './assets';
import { findings, nativeNode, type CanonicalAsset, type CompatibilityFinding } from './manifest';
import { unityFiles } from './unity';
import { godotFiles } from './godot';
export type EngineTarget = 'unity' | 'godot';
export interface EngineExportOptions {
  target: EngineTarget;
  scenes: SceneSpec[];
  entrySceneId: string;
  assetBytes: (url: string) => Uint8Array;
  primitiveFactory: (node: SceneNode) => Object3D;
  emit: (path: string, bytes: Uint8Array) => void;
  signal?: AbortSignal;
}
export async function writeEngineExport(options: EngineExportOptions): Promise<void> {
  const { target, emit, signal } = options;
  const check = () => signal?.throwIfAborted();
  check();
  if (target !== 'unity' && target !== 'godot') throw new Error('Invalid engine export target');
  const scenes = options.scenes.map((s) => assertScene(s));
  if (
    !scenes.length ||
    new Set(scenes.map((s) => s.id)).size !== scenes.length ||
    !scenes.some((s) => s.id === options.entrySceneId)
  )
    throw new Error('Invalid or duplicate engine scene entrySceneId');
  const assets: CanonicalAsset[] = [];
  const compatibility: CompatibilityFinding[] = [];
  const out = [];
  for (const scene of scenes) {
    check();
    compatibility.push(...findings(scene));
    if (target === 'unity')
      compatibility.push({
        code: 'UNITY_ENVIRONMENT_LIMITATION',
        feature: 'environment',
        severity: 'warning',
        sceneId: scene.id,
        message:
          'Prefab retains ambient/fog values as metadata; global RenderSettings require scene configuration.',
      });
    const nodes = [];
    for (const node of scene.nodes) {
      check();
      let model: string | undefined;
      if (node.kind === 'mesh') {
        const asset = node.assetId ? scene.assets.find((a) => a.id === node.assetId) : undefined;
        const bytes =
          node.shape === 'glb' && asset
            ? await importedModel(options.assetBytes(asset.url), node, (code, feature, message) =>
                compatibility.push({
                  code,
                  feature,
                  message,
                  severity: 'warning',
                  sceneId: scene.id,
                  nodeId: node.id,
                  assetId: asset.id,
                }),
              )
            : await proceduralModel(options.primitiveFactory(node));
        check();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        model = sha256;
        const source = asset
          ? { sceneId: scene.id, assetId: asset.id, url: asset.url, assetNode: node.assetNode }
          : undefined;
        const existing = assets.find((a) => a.id === model);
        if (
          existing &&
          source &&
          !existing.sources.some((s) => JSON.stringify(s) === JSON.stringify(source))
        )
          existing.sources.push(source);
        if (!existing) {
          const path = `models/${sha256}.glb`;
          emit(path, bytes);
          check();
          if (target === 'godot') emit(`raw/${sha256}.glb.bin`, bytes);
          assets.push({
            id: sha256,
            path,
            sha256,
            bytes: bytes.byteLength,
            ...(source ? { source } : {}),
            sources: source ? [source] : [],
          });
        }
      }
      nodes.push(nativeNode(node, scene, model));
    }
    out.push({
      id: scene.id,
      name: scene.name,
      nodes,
      environment: scene.environment,
      camera: scene.camera,
      spawn: scene.spawn,
      metadata: scene,
      metadataJson: JSON.stringify(scene),
    });
  }
  const manifest = {
    version: 1,
    target,
    coordinates: { handedness: 'right', up: 'Y', units: 'metres', quaternion: 'xyzw' },
    entrySceneId: options.entrySceneId,
    assets,
    scenes: out,
    compatibility,
  };
  const text = (path: string, value: string) => {
    check();
    emit(path, new TextEncoder().encode(value));
  };
  text('engine-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  text(
    'compatibility.json',
    JSON.stringify({ version: 1, target, findings: compatibility }, null, 2) + '\n',
  );
  for (const [path, content] of Object.entries(target === 'unity' ? unityFiles() : godotFiles()))
    text(path, content);
  check();
}
