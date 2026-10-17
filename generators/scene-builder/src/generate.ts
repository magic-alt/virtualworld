import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { assertScene, SceneSchema } from '@virtualworld/scene-schema';
import { builtinPlan, planWorld, validatePlan, type WorldInput } from '@virtualworld/planner/world';
import type { LlmConfig } from '@virtualworld/planner';
import { TripoProvider, type TripoOptions, type TripoResult } from '@virtualworld/tripo';
import { optimizeWithBlender } from '@virtualworld/blender';
import { writeWorld, readWorld, inside } from './io';
import { optimizeGlb, sha256, atomicWrite } from './pipeline';
import { validateWorldAssets } from './validate';
export type GenerateOptions = WorldInput & {
  root: string;
  planner: 'builtin' | 'llm';
  assets: 'builtin' | 'tripo';
  llm?: LlmConfig;
  tripo?: Partial<TripoOptions>;
  blender?: boolean;
  signal?: AbortSignal;
  taskId?: string;
  taskNodeId?: string;
};
export async function generateWorld(options: GenerateOptions) {
  const root = resolve(options.root),
    assetRoot = join(root, 'assets');
  SceneSchema.shape.id.parse(options.id);
  if (!options.description.trim() || options.description.length > 4000)
    throw new Error('Description must be 1..4000 characters');
  const worldPath = inside(join(root, 'worlds'), options.id);
  const worldManifest = inside(assetRoot, `manifests/worlds/${options.id}.json`);
  let reference = options.referenceImage,
    referenceHash: string | undefined;
  if (reference && !/^https?:\/\//.test(reference)) {
    const data = await readFile(resolve(reference)),
      ext = extname(reference).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext) || data.length > 20 * 1024 * 1024)
      throw new Error('Reference image must be PNG/JPEG, at most 20 MiB');
    referenceHash = sha256(data);
    await atomicWrite(join(assetRoot, 'source', 'generated', `${referenceHash}${ext}`), data);
    reference = `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
  }
  if (options.planner === 'builtin' && reference)
    throw new Error('The builtin planner does not interpret images; use --planner llm');
  const generationOptions = {
    id: options.id,
    referenceHash,
    planner: options.planner,
    assets: options.assets,
    description: options.description,
    reference: options.referenceImage,
    blender: !!options.blender,
    llmModel: options.llm?.model || process.env.LLM_MODEL || '',
    tripoModel: options.tripo?.model || process.env.TRIPO_MODEL || 'v3.1-20260211',
    builder: 1,
  };
  const requestHash = sha256(JSON.stringify(generationOptions));
  const retainedSources = new Map<string, TripoResult>();
  let repairing = false;
  try {
    const existing = await readWorld(worldPath);
    let previous: {
      requestHash?: string;
      sceneSha256?: string;
      assets?: { id: string; manifest: string }[];
    };
    try {
      previous = JSON.parse(await readFile(worldManifest, 'utf8'));
    } catch {
      throw new Error(
        `World ${options.id} already exists without generation provenance; choose a new --id`,
      );
    }
    if (
      previous.requestHash !== requestHash ||
      previous.sceneSha256 !== sha256(JSON.stringify(existing))
    )
      throw new Error(`World ${options.id} already exists; choose a new --id`);
    let intact = true;
    if ((previous.assets?.length || 0) !== existing.assets.length) intact = false;
    for (const artifact of previous.assets || []) {
      try {
        const receipt = JSON.parse(await readFile(inside(root, artifact.manifest), 'utf8'));
        try {
          const sourcePath = inside(assetRoot, receipt.source),
            bytes = await readFile(sourcePath);
          if (
            sha256(bytes) === receipt.sourceSha256 &&
            receipt.provider === 'tripo-v3' &&
            typeof receipt.taskId === 'string' &&
            typeof receipt.model === 'string'
          ) {
            for (const n of existing.nodes.filter((n) => n.assetId === artifact.id))
              retainedSources.set(n.id, {
                provider: 'tripo-v3',
                model: receipt.model,
                taskId: receipt.taskId,
                requestHash: receipt.requestHash,
                sourcePath,
                sha256: receipt.sourceSha256,
                bytes: bytes.length,
                cacheHit: true,
              });
          }
        } catch {}
        const output = await readFile(inside(assetRoot, receipt.output));
        if (sha256(output) !== receipt.processing.outputSha256) intact = false;
      } catch {
        intact = false;
      }
    }
    try {
      await validateWorldAssets(existing, root);
    } catch {
      intact = false;
    }
    if (intact) return { directory: worldPath, manifest: worldManifest, scene: existing };
    repairing = true;
    // Same request and unchanged world, but missing/corrupt artifacts: rebuild using the
    // persisted plan and Tripo source/task cache. No paid task is recreated.
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const planInput = { id: options.id, description: options.description, referenceImage: reference };
  const planHash = requestHash;
  const planPath = join(assetRoot, 'manifests', 'plans', `${planHash}.json`);
  let plan;
  try {
    plan = validatePlan(JSON.parse(await readFile(planPath, 'utf8')), options.id);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    if (repairing)
      throw new Error(
        'Cannot safely repair a world without its persisted plan; restore the plan before retrying',
      );
    plan =
      options.planner === 'builtin'
        ? builtinPlan(planInput)
        : await planWorld(
            planInput,
            options.llm || {
              baseUrl: process.env.LLM_BASE_URL || '',
              model: process.env.LLM_MODEL || '',
              key: process.env.LLM_API_KEY || '',
            },
            options.signal,
          );
    await atomicWrite(planPath, JSON.stringify(plan, null, 2) + '\n');
  }
  const scene = plan.scene,
    assets: unknown[] = [];
  if (options.taskId && plan.assetRequests.length > 1 && !options.taskNodeId)
    throw new Error('Multiple asset requests: specify --task-node together with --task-id');
  if (options.taskNodeId && !plan.assetRequests.some((r) => r.nodeId === options.taskNodeId))
    throw new Error('Unknown --task-node');
  if (options.assets === 'tripo') {
    const sourceRoot = join(assetRoot, 'source', 'generated'),
      cacheRoot = join(assetRoot, 'manifests', 'jobs');
    const provider = new TripoProvider({
      key: process.env.TRIPO_API_KEY || '',
      baseUrl: process.env.TRIPO_BASE_URL,
      model: process.env.TRIPO_MODEL,
      sourceRoot,
      cacheRoot,
      ...options.tripo,
    });
    let imageInput = options.referenceImage;
    if (reference?.startsWith('data:') && !retainedSources.has(plan.assetRequests[0]?.nodeId))
      imageInput = await provider.uploadImage(
        Buffer.from(reference.split(',')[1], 'base64'),
        `reference${extname(options.referenceImage!)}`,
        options.signal,
      );
    // Sequential generation intentionally bounds concurrency and cost.
    for (const [i, request] of plan.assetRequests.entries()) {
      const recoveryNode = options.taskNodeId || plan.assetRequests[0]?.nodeId;
      const result =
        retainedSources.get(request.nodeId) ||
        (await provider.generate(
          { prompt: request.prompt, ...(i === 0 && imageInput ? { image: imageInput } : {}) },
          options.signal,
          request.nodeId === recoveryNode ? options.taskId : undefined,
        ));
      let bytes = await readFile(result.sourcePath);
      let blenderLog: string | undefined;
      if (options.blender) {
        const intermediate = join(
          assetRoot,
          'optimized',
          'generated',
          `${result.sha256}-blender.glb`,
        );
        blenderLog = (
          await optimizeWithBlender(result.sourcePath, intermediate, { signal: options.signal })
        ).log;
        bytes = await readFile(intermediate);
      }
      const node = scene.nodes.find((n) => n.id === request.nodeId)!;
      const buildHash = sha256(
        JSON.stringify({
          source: result.sha256,
          pipeline: 1,
          extent: Math.max(...node.size),
          blender: !!options.blender,
        }),
      );
      const output = join(assetRoot, 'optimized', 'generated', `${buildHash}.glb`);
      const processed = await optimizeGlb(bytes, output, {
        normalizeExtent: Math.max(...node.size),
      });
      const asset = {
        id: `generated-${buildHash.slice(0, 20)}`,
        name: node.name,
        type: 'glb' as const,
        url: `/assets/optimized/generated/${buildHash}.glb`,
        bytes: processed.outputBytes,
      };
      if (!scene.assets.some((a) => a.id === asset.id)) scene.assets.push(asset);
      node.shape = 'glb';
      node.assetId = asset.id;
      node.assetNode = undefined;
      node.materialOverride = false;
      const manifest = {
        version: 1,
        id: asset.id,
        provider: result.provider,
        model: result.model,
        prompt: request.prompt,
        requestHash: result.requestHash,
        taskId: result.taskId,
        sourceSha256: result.sha256,
        source: `source/generated/${result.sha256}.glb`,
        output: `optimized/generated/${buildHash}.glb`,
        processing: processed,
        blenderLog,
        createdAt: new Date().toISOString(),
      };
      const manifestPath = join(assetRoot, 'manifests', 'generated', `${buildHash}.json`);
      await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      assets.push({ id: asset.id, manifest: `assets/manifests/generated/${buildHash}.json` });
    }
  }
  const compiled = assertScene(scene);
  const directory = await writeWorld(join(root, 'worlds'), compiled);
  const manifest = inside(assetRoot, `manifests/worlds/${options.id}.json`);
  await mkdir(join(assetRoot, 'manifests', 'worlds'), { recursive: true });
  await atomicWrite(
    manifest,
    JSON.stringify(
      {
        version: 1,
        worldId: scene.id,
        requestHash,
        planner:
          options.planner === 'builtin'
            ? 'builtin-procedural-v1'
            : options.llm?.model || process.env.LLM_MODEL,
        assetProvider: options.assets,
        descriptionSha256: sha256(options.description),
        referenceSha256: referenceHash,
        referenceImage: options.referenceImage,
        sceneSha256: sha256(JSON.stringify(compiled)),
        assets,
        tools: { builder: 'scene-builder/1' },
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  return { directory, manifest, scene: compiled };
}
