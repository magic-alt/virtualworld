import Fastify, { LogController } from 'fastify';
import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertScene, SceneSchema } from '@virtualworld/scene-schema';
import { ProjectStore, HttpError } from './store';
import { AgentInput, propose, PlannerError, type LlmConfig } from '@virtualworld/planner';
import { createExport, within } from './export';
import { recordUpload } from '@virtualworld/scene-builder/asset-library';
import { GenerationService } from './generation';
import { serveStatic } from './static';
import { AccessPolicySchema, serviceLimits, type AccessPolicy, type ServiceLimits } from './config';
import { registerAccess } from './access';
import { OperationGate } from './admission';
import { acquireServiceLease } from './service-lease';
import { validateGlb } from '@virtualworld/scene-builder/pipeline';
import { resolveAssetFile, resolveUploadFile } from './asset-files';
import { parseRequest } from './request-validation';
const LIMIT = 100 * 1024 * 1024;
// Classify semantic errors at the request boundary only. An invalid saved file
// or a programming error still reaches the sanitized 500 handler.
function assertInputScene(input: unknown) {
  try {
    return assertScene(input);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : '场景无效');
  }
}
async function readRuntimeGlb(path: string, declaredBytes?: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat({ bigint: true });
    const size = Number(info.size);
    if (!info.isFile() || size > LIMIT) throw new HttpError(400, 'GLB 超过 100 MiB 上限或不是文件');
    if (declaredBytes !== undefined && declaredBytes !== size)
      throw new HttpError(400, '资源长度不匹配');
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const result = await handle.read(bytes, offset, Math.min(64 * 1024, size - offset), offset);
      if (!result.bytesRead) throw new HttpError(400, '校验期间资源发生变化，请重试');
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.size !== info.size ||
      after.mtimeNs !== info.mtimeNs ||
      after.ctimeNs !== info.ctimeNs
    )
      throw new HttpError(400, '校验期间资源发生变化，请重试');
    return bytes;
  } finally {
    await handle.close();
  }
}
export async function createApp(
  options: {
    dataRoot?: string;
    playerRoot?: string;
    publicRoot?: string;
    studioRoot?: string;
    projectRoot?: string;
    assetLibraryRoot?: string;
    llm?: LlmConfig;
    accessPolicy?: AccessPolicy;
    limits?: Partial<ServiceLimits>;
    generatedRoot?: string;
  } = {},
) {
  const accessPolicy = AccessPolicySchema.parse(
    options.accessPolicy || {
      mode: 'local',
      port: Number(process.env.PORT || 3001),
    },
  );
  const limits = serviceLimits(options.limits);
  const root = resolve(options.dataRoot || 'data'),
    assetRoot = join(root, 'assets'),
    publicRoot = resolve(options.publicRoot || 'public');
  const projectRoot = resolve(options.projectRoot || '.');
  const generatedRoot = resolve(
    options.generatedRoot ||
      (accessPolicy.mode === 'hosted' ? join(root, 'workspace') : projectRoot),
  );
  if (accessPolicy.mode === 'hosted' && generatedRoot !== within(root, 'workspace'))
    throw new Error('Hosted generated content must use the persistent data/workspace directory');
  const assetLibraryRoot = resolve(options.assetLibraryRoot || join(projectRoot, 'assets'));
  const uploadLibraryRoot = resolve(
    options.assetLibraryRoot || (options.dataRoot ? join(root, 'asset-library') : assetLibraryRoot),
  );
  const playerRoot = resolve(options.playerRoot || 'dist/player'),
    studioRoot = resolve(options.studioRoot || 'dist/web');
  const config = options.llm || {
    baseUrl: process.env.LLM_BASE_URL || '',
    model: process.env.LLM_MODEL || '',
    key: process.env.LLM_API_KEY || '',
  };
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 120000,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger: accessPolicy.mode === 'hosted' ? { level: 'info' } : false,
  });
  const store = new ProjectStore(root, join(projectRoot, 'worlds'), [
    join(generatedRoot, 'worlds'),
  ]);
  const roots = {
    uploadLibraryRoot,
    assetRoot,
    publicRoot,
    runtimeAssetRoots: [...new Set([assetLibraryRoot, join(generatedRoot, 'assets')])],
  };
  const agents = new OperationGate(limits.maxAgentRequests, 'AI 编辑服务');
  const exports = new OperationGate(limits.maxExports, '导出服务');
  await mkdir(assetRoot, { recursive: true });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: LIMIT },
    (_req, body, done) => done(null, body),
  );
  registerAccess(app, accessPolicy);
  app.setErrorHandler((error, req, reply) => {
    const known = error instanceof HttpError || error instanceof PlannerError;
    const fastifyError = error as { code?: string; statusCode?: number };
    const requestError =
      fastifyError.code?.startsWith('FST_ERR_') &&
      fastifyError.statusCode &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode < 500;
    const status = known ? error.statusCode : requestError ? fastifyError.statusCode! : 500;
    if (!known && !requestError) {
      // Deliberately exclude bodies, provider messages and local file contents from routine logs.
      req.log.error(
        {
          requestId: req.id,
          route: req.routeOptions.url,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          code: fastifyError.code,
        },
        'Request failed',
      );
    }
    if (status === 429) reply.header('Retry-After', '2');
    reply.code(status).send({
      error: known
        ? error.message
        : requestError
          ? status === 413
            ? '请求体超过大小限制'
            : '请求格式无效'
          : '服务器暂时无法完成请求',
      ...(!known && !requestError ? { requestId: req.id } : {}),
    });
  });
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/health', async () => ({
    ok: true,
    aiConfigured: !!(config.baseUrl && config.key && config.model),
  }));
  const generation = new GenerationService(root, generatedRoot, config, {
    maxPending: limits.maxPendingGenerations,
  });
  app.get('/api/service', async () => ({
    mode: accessPolicy.mode,
    workspace: 'shared',
    persistence: 'filesystem-single-writer',
    generation: generation.capacity(),
    operations: { agents: agents.active, exports: exports.active },
    limits,
    realtimeMultiplayer: false,
  }));
  app.get('/api/generation/capabilities', async () => generation.capabilities());
  app.post<{ Querystring: { name?: string } }>(
    '/api/generation/references',
    { bodyLimit: 20 * 1024 * 1024 },
    async (req) => {
      if (!Buffer.isBuffer(req.body)) throw new HttpError(400, '请上传图片文件');
      return generation.upload(req.query.name || '', req.body);
    },
  );
  app.post('/api/generations', async (req, reply) =>
    reply.code(202).send(await generation.create(req.body)),
  );
  app.get<{ Params: { id: string } }>('/api/generations/:id', async (req) =>
    generation.get(req.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/generations/:id/resume', async (req, reply) =>
    reply.code(202).send(await generation.resume(req.params.id, req.body)),
  );
  app.get('/api/projects', async () => ({
    projects: await store.list(),
    aiConfigured: !!(config.baseUrl && config.key && config.model),
  }));
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => store.get(req.params.id));
  app.get('/api/campaigns', async () => ({ campaigns: await store.campaigns() }));
  app.get<{ Params: { id: string } }>('/api/campaigns/:id', async (req) =>
    store.campaign(req.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const body = parseRequest(
      z.object({ scene: SceneSchema, baseRevision: z.number().int().nonnegative() }).strict(),
      req.body,
    );
    return store.save(req.params.id, assertInputScene(body.scene), body.baseRevision);
  });
  app.post<{ Querystring: { name: string; sourceAssetId?: string } }>(
    '/api/assets',
    { bodyLimit: LIMIT },
    async (req) => {
      const name = req.query.name;
      if (!name || name.length > 200 || /[\\/\x00-\x1f]/.test(name))
        throw new HttpError(400, '非法文件名');
      const ext = extname(name).toLowerCase();
      if (!['.glb', '.step', '.stp', '.spz', '.ply'].includes(ext))
        throw new HttpError(400, '只支持 GLB、STEP/STP、SPZ、Gaussian PLY');
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw new HttpError(400, '文件为空');
      const digest = createHash('sha256').update(bytes).digest('hex'),
        filename = digest + ext;
      try {
        await recordUpload(uploadLibraryRoot, bytes, name, req.query.sourceAssetId);
      } catch (error) {
        // Content validation failures are actionable client errors; filesystem failures remain 500.
        if ((error as NodeJS.ErrnoException).code) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : '资源校验失败');
      }
      return {
        id: `a-${digest.slice(0, 20)}`,
        name,
        type: ['.step', '.stp'].includes(ext)
          ? 'source'
          : ['.spz', '.ply'].includes(ext)
            ? 'splat'
            : 'glb',
        url: `/api/assets/${filename}`,
        bytes: bytes.length,
      };
    },
  );
  app.route<{ Params: { file: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/assets/:file',
    handler: async (req, reply) => {
      if (!/^[a-f0-9]{64}\.(glb|step|stp|spz|ply)$/.test(req.params.file))
        throw new HttpError(400, '非法资源');
      try {
        const file = await resolveUploadFile(req.params.file, roots);
        return serveStatic(file.path, file.root, req, reply);
      } catch {
        throw new HttpError(404, '文件不存在');
      }
    },
  });
  app.post('/api/agent', async (req, reply) => {
    const input = parseRequest(AgentInput, req.body);
    assertInputScene(input.scene);
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.on('close', abort);
    try {
      return await agents.run(() => propose(input, config, controller.signal));
    } finally {
      reply.raw.off('close', abort);
    }
  });
  app.post('/api/validate', async (req) => {
    const { scene } = parseRequest(z.object({ scene: SceneSchema }), req.body);
    assertInputScene(scene);
    const validation = [];
    for (const a of scene.assets) {
      try {
        const file = await resolveAssetFile(a, roots);
        if (a.type === 'glb') {
          const bytes = await readRuntimeGlb(file.path, a.bytes);
          validation.push({ assetId: a.id, ...(await validateGlb(bytes)) });
        }
      } catch (error) {
        throw new HttpError(
          400,
          `资源校验失败 (${a.name}): ${error instanceof HttpError ? error.message : '文件缺失或不符合自包含 GLB 格式'}`,
        );
      }
    }
    return { ok: true, nodes: scene.nodes.length, assets: scene.assets.length, validation };
  });
  app.post('/api/export', async (req, reply) => {
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    const checkConnected = () => {
      if (req.raw.aborted || reply.raw.destroyed) controller.abort();
      controller.signal.throwIfAborted();
    };
    // Register before any asynchronous chapter/catalog preflight. A close event
    // that happened before the handler began is caught by checkConnected too.
    req.raw.on('aborted', abort);
    reply.raw.on('close', abort);
    try {
      checkConnected();
      const { scene, target } = parseRequest(
        z.object({ scene: SceneSchema, target: z.enum(['web', 'unity', 'godot']).optional() }),
        req.body,
      );
      assertInputScene(scene);
      const zip = await exports.run(async () => {
        checkConnected();
        await store.checkChapter(scene);
        checkConnected();
        const campaign = scene.campaign ? await store.campaign(scene.campaign.id) : undefined;
        checkConnected();
        return createExport(scene, {
          target,
          playerRoot,
          assetRoot,
          publicRoot,
          assetLibraryRoot: uploadLibraryRoot,
          runtimeAssetRoot: assetLibraryRoot,
          additionalRuntimeAssetRoots: roots.runtimeAssetRoots.slice(1),
          maxBytes: limits.maxExportBytes,
          signal: controller.signal,
          campaign,
        });
      });
      checkConnected();
      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', 'attachment; filename="virtualworld.zip"');
      return zip;
    } finally {
      req.raw.off('aborted', abort);
      reply.raw.off('close', abort);
    }
  });
  app.route<{ Params: { '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/fixtures/*',
    handler: (req, reply) =>
      serveStatic(within(publicRoot, `fixtures/${req.params['*']}`), publicRoot, req, reply),
  });
  app.route<{ Params: { '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/assets/optimized/*',
    handler: async (req, reply) => {
      const url = `/assets/optimized/${req.params['*']}`;
      const file = await resolveAssetFile(
        { url, type: extname(url) === '.glb' ? 'glb' : 'splat' },
        roots,
        false,
      );
      return serveStatic(file.path, file.root, req, reply);
    },
  });
  app.route<{ Params: { '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: (req, reply) => {
      const path = req.params['*'] || 'index.html';
      const immutable = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path);
      return serveStatic(within(studioRoot, path), studioRoot, req, reply, immutable);
    },
  });
  // Acquire before init: init may mark abandoned generation records interrupted.
  const releaseLease = await acquireServiceLease(root);
  app.addHook('onClose', async () => {
    try {
      await generation.close();
    } finally {
      await releaseLease();
    }
  });
  try {
    await generation.init();
    await app.ready();
    return app;
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}
