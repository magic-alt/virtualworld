import Fastify from 'fastify';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertScene, SceneSchema } from '@virtualworld/scene-schema';
import { ProjectStore, HttpError } from './store';
import { AgentInput, propose, type LlmConfig } from '@virtualworld/planner';
import { createExport, within } from './export';
import { recordUpload, readUpload } from '@virtualworld/scene-builder/asset-library';
import { GenerationService } from './generation';
import { serveStatic } from './static';
const LIMIT = 100 * 1024 * 1024;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.ply': 'application/octet-stream',
  '.spz': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
export async function createApp(
  options: {
    dataRoot?: string;
    playerRoot?: string;
    publicRoot?: string;
    studioRoot?: string;
    projectRoot?: string;
    assetLibraryRoot?: string;
    llm?: LlmConfig;
  } = {},
) {
  const root = resolve(options.dataRoot || 'data'),
    assetRoot = join(root, 'assets'),
    publicRoot = resolve(options.publicRoot || 'public');
  const projectRoot = resolve(options.projectRoot || '.');
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
  const app = Fastify({ bodyLimit: LIMIT, logger: false });
  const store = new ProjectStore(root, join(projectRoot, 'worlds'));
  await mkdir(assetRoot, { recursive: true });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: LIMIT },
    (_req, body, done) => done(null, body),
  );
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        const u = new URL(origin);
        allowed =
          ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
          [String(process.env.PORT || 3001), '5173'].includes(u.port);
      } catch {}
      if (!allowed) return reply.code(403).send({ error: '拒绝来自其他站点的本地服务访问' });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof HttpError ? error.statusCode : (error as any).statusCode || 400;
    reply.code(status).send({
      error:
        error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : error instanceof Error
            ? error.message
            : String(error),
    });
  });
  app.get('/api/health', async () => ({
    ok: true,
    aiConfigured: !!(config.baseUrl && config.key && config.model),
  }));
  const generation = new GenerationService(root, projectRoot, config);
  await generation.init();
  app.addHook('onClose', () => generation.close());
  app.get('/api/generation/capabilities', async () => generation.capabilities());
  app.post<{ Querystring: { name?: string } }>('/api/generation/references', async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, '请上传图片文件');
    return generation.upload(req.query.name || '', req.body);
  });
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
    const body = z
      .object({ scene: SceneSchema, baseRevision: z.number().int().nonnegative() })
      .strict()
      .parse(req.body);
    return store.save(req.params.id, body.scene, body.baseRevision);
  });
  app.post<{ Querystring: { name: string; sourceAssetId?: string } }>(
    '/api/assets',
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
      await recordUpload(uploadLibraryRoot, bytes, name, req.query.sourceAssetId);
      return {
        id: `a-${digest.slice(0, 20)}`,
        name,
        type: ['.spz', '.ply'].includes(ext) ? 'splat' : 'glb',
        url: `/api/assets/${filename}`,
        bytes: bytes.length,
      };
    },
  );
  app.get<{ Params: { file: string } }>('/api/assets/:file', async (req, reply) => {
    if (!/^[a-f0-9]{64}\.(glb|step|stp|spz|ply)$/.test(req.params.file))
      throw new HttpError(400, '非法资源');
    try {
      return reply
        .type(types[extname(req.params.file)] || 'application/octet-stream')
        .send(await readUpload(uploadLibraryRoot, assetRoot, req.params.file));
    } catch {
      throw new HttpError(404, '文件不存在');
    }
  });
  app.post('/api/agent', async (req, reply) => {
    const input = AgentInput.parse(req.body);
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.on('close', abort);
    try {
      return await propose(input, config, controller.signal);
    } finally {
      reply.raw.off('close', abort);
    }
  });
  app.post('/api/validate', async (req) => {
    const { scene } = z.object({ scene: SceneSchema }).parse(req.body);
    assertScene(scene);
    for (const a of scene.assets) {
      if (a.url.startsWith('/api/assets/')) {
        try {
          await readUpload(uploadLibraryRoot, assetRoot, a.url.slice(12));
          continue;
        } catch {
          throw new HttpError(400, `资源缺失: ${a.name}`);
        }
      }
      const file = a.url.startsWith('/assets/optimized/')
        ? within(assetLibraryRoot, a.url.slice('/assets/'.length))
        : a.url.startsWith('/fixtures/')
          ? within(publicRoot, a.url.slice(1))
          : null;
      if (!file) throw new HttpError(400, `资源不可读取: ${a.name}`);
      try {
        await stat(file);
      } catch {
        throw new HttpError(400, `资源缺失: ${a.name}`);
      }
    }
    return { ok: true, nodes: scene.nodes.length, assets: scene.assets.length };
  });
  app.post('/api/export', async (req, reply) => {
    const { scene } = z.object({ scene: SceneSchema }).parse(req.body);
    await store.checkChapter(scene);
    const zip = await createExport(scene, {
      playerRoot,
      assetRoot,
      publicRoot,
      assetLibraryRoot: uploadLibraryRoot,
      runtimeAssetRoot: assetLibraryRoot,
      campaign: scene.campaign ? await store.campaign(scene.campaign.id) : undefined,
    });
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="virtualworld.zip"');
    return zip;
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
    handler: (req, reply) =>
      serveStatic(
        within(assetLibraryRoot, `optimized/${req.params['*']}`),
        assetLibraryRoot,
        req,
        reply,
      ),
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
  await app.ready();
  return app;
}
