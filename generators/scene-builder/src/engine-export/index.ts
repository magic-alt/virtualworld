import { createHash } from 'node:crypto';
import {
  assertScene,
  CampaignSchema,
  node as createNode,
  type CampaignSpec,
  type SceneSpec,
  type SceneNode,
} from '@virtualworld/scene-schema';
import type { Object3D } from 'three';
import { importedModel, proceduralModel } from './assets';
import {
  findings,
  nativeNode,
  nativeRuntime,
  type CanonicalAsset,
  type CompatibilityFinding,
  type EngineTarget,
} from './manifest';
import { unityFiles } from './unity';
import { godotFiles } from './godot';
import { unrealFiles } from './unreal';
import { stepToolFiles } from './step-tools';
export type { EngineTarget } from './manifest';
export interface EngineExportOptions {
  target: EngineTarget;
  scenes: SceneSpec[];
  entrySceneId: string;
  campaign?: CampaignSpec;
  assetBytes: (url: string) => Uint8Array;
  primitiveFactory: (node: SceneNode) => Object3D;
  emit: (path: string, bytes: Uint8Array) => void;
  signal?: AbortSignal;
  /** Emit only canonical data when extending a local native inspection catalog. */
  dataOnly?: boolean;
}
export async function writeEngineExport(options: EngineExportOptions): Promise<void> {
  const { target, signal } = options;
  const check = () => signal?.throwIfAborted();
  const emit = (path: string, bytes: Uint8Array) => {
    check();
    options.emit(path, bytes);
    check();
  };
  check();
  if (target !== 'unity' && target !== 'unreal' && target !== 'godot')
    throw new Error('Invalid engine export target');
  const scenes = options.scenes.map((s) => assertScene(s));
  if (
    !scenes.length ||
    new Set(scenes.map((s) => s.id)).size !== scenes.length ||
    !scenes.some((s) => s.id === options.entrySceneId)
  )
    throw new Error('Invalid or duplicate engine scene entrySceneId');
  const campaign = options.campaign ? CampaignSchema.parse(options.campaign) : undefined;
  if (campaign) {
    if (campaign.chapters.length !== scenes.length)
      throw new Error('Campaign chapters must match the exported scenes');
    for (const [index, chapter] of campaign.chapters.entries()) {
      const scene = scenes.find((candidate) => candidate.id === chapter.id);
      if (
        scene?.campaign?.id !== campaign.id ||
        scene.campaign.chapterId !== chapter.id ||
        scene.campaign.index !== index
      )
        throw new Error(`Campaign chapter metadata mismatch: ${chapter.id}`);
    }
  }
  const assets: CanonicalAsset[] = [];
  const assetsById = new Map<string, CanonicalAsset>();
  const compatibility: CompatibilityFinding[] = [];
  const runtime = nativeRuntime(target);
  const recordModel = (bytes: Uint8Array, source?: CanonicalAsset['source']) => {
    check();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = assetsById.get(sha256);
    if (existing) {
      if (source && !existing.sources.some((s) => JSON.stringify(s) === JSON.stringify(source)))
        existing.sources.push(source);
      return sha256;
    }
    const path = `models/${sha256}.glb`;
    emit(path, bytes);
    if (target === 'godot') emit(`raw/${sha256}.glb.bin`, bytes);
    if (target === 'unreal') emit(`Content/VirtualWorldData/${path}`, bytes);
    const asset: CanonicalAsset = {
      id: sha256,
      path,
      sha256,
      bytes: bytes.byteLength,
      ...(source ? { source } : {}),
      sources: source ? [source] : [],
    };
    assets.push(asset);
    assetsById.set(sha256, asset);
    return sha256;
  };
  const out = [];
  for (const scene of scenes) {
    check();
    compatibility.push(...findings(scene, target));
    if (runtime && scene.campaign && !campaign)
      compatibility.push({
        code: 'CAMPAIGN_PREREQUISITES_UNAVAILABLE',
        feature: 'campaign prerequisites',
        severity: 'warning',
        sceneId: scene.id,
        message:
          'No campaign manifest was supplied; chapter membership is retained, but native chapter prerequisites cannot be enforced.',
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
        const source = asset
          ? { sceneId: scene.id, assetId: asset.id, url: asset.url, assetNode: node.assetNode }
          : undefined;
        model = recordModel(bytes, source);
      }
      nodes.push(nativeNode(node, scene, model));
    }
    let actorModel: string | undefined;
    if (scene.actor) {
      check();
      // An actor may have no authored preview node (B612/Earth), or its preview
      // may have material overrides. The runtime always needs the complete,
      // unchanged GLB with its skin, hierarchy and named animation clips.
      const asset = scene.assets.find((candidate) => candidate.id === scene.actor!.assetId)!;
      const bytes = await importedModel(
        options.assetBytes(asset.url),
        createNode('actor-model', 'Actor model', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', {
          assetId: asset.id,
        }),
        (code, feature, message) =>
          compatibility.push({
            code,
            feature,
            message,
            severity: 'warning',
            sceneId: scene.id,
            assetId: asset.id,
          }),
      );
      actorModel = recordModel(bytes, { sceneId: scene.id, assetId: asset.id, url: asset.url });
    }
    out.push({
      id: scene.id,
      name: scene.name,
      nodes,
      environment: scene.environment,
      camera: scene.camera,
      spawn: scene.spawn,
      ...(actorModel ? { actorModel } : {}),
      metadata: scene,
      metadataJson: JSON.stringify(scene),
    });
  }
  const manifest = {
    version: 1,
    target,
    coordinates: { handedness: 'right', up: 'Y', units: 'metres', quaternion: 'xyzw' },
    entrySceneId: options.entrySceneId,
    ...(campaign ? { campaign } : {}),
    ...(runtime ? { runtime } : {}),
    assets,
    scenes: out,
    compatibility,
  };
  const text = (path: string, value: string) => emit(path, new TextEncoder().encode(value));
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  text('engine-manifest.json', manifestJson);
  if (target === 'unreal') text('Content/VirtualWorldData/engine-manifest.json', manifestJson);
  text(
    'compatibility.json',
    JSON.stringify({ version: 1, target, findings: compatibility }, null, 2) + '\n',
  );
  if (options.dataOnly) return;
  const adapterFiles =
    target === 'unity' ? unityFiles() : target === 'unreal' ? unrealFiles() : godotFiles();
  for (const [path, content] of Object.entries(adapterFiles)) text(path, content);
  if (target === 'unreal')
    for (const [path, bytes] of Object.entries(await stepToolFiles())) emit(path, bytes);
  check();
}
