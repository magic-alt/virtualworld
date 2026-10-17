import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const TripoRequest = z
  .object({
    prompt: z.string().min(1).max(1024),
    image: z
      .string()
      .max(4000)
      .refine(
        (s) => /^https?:\/\//.test(s) || /^file_[a-zA-Z0-9_-]+$/.test(s),
        'Use an image URL or uploaded file token',
      )
      .optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    faceLimit: z.number().int().min(500).max(100000).default(20000),
  })
  .strict();
export type TripoOptions = {
  key: string;
  cacheRoot: string;
  sourceRoot: string;
  baseUrl?: string;
  model?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};
const Ledger = z
  .object({
    version: z.literal(1),
    requestHash: z.string(),
    provider: z.literal('tripo-v3'),
    model: z.string(),
    request: TripoRequest,
    phase: z.enum(['creating', 'polling', 'success', 'failed']),
    taskId: z.string().optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    bytes: z.number().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
type Job = z.infer<typeof Ledger>;
export type TripoResult = {
  provider: 'tripo-v3';
  model: string;
  requestHash: string;
  taskId: string;
  sourcePath: string;
  sha256: string;
  bytes: number;
  cacheHit: boolean;
};
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
async function atomic(path: string, bytes: Uint8Array | string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, path);
}
async function readLimited(response: Response, signal: AbortSignal) {
  const limit = 100 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit)
    throw new Error('Tripo asset exceeds 100 MiB');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Tripo asset is empty');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('Tripo asset exceeds 100 MiB');
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error('Tripo asset is empty');
  return Buffer.concat(chunks, total);
}

/** Local CLI provider. Creating a paid task is never automatically retried. */
export class TripoProvider {
  private inflight = new Map<string, Promise<TripoResult>>();
  private base: string;
  private model: string;
  constructor(private options: TripoOptions) {
    this.base = (options.baseUrl || 'https://openapi.tripo3d.ai/v3').replace(/\/+$/, '');
    this.model = options.model || 'v3.1-20260211';
    if (!/^https?:\/\//.test(this.base)) throw new Error('Invalid Tripo base URL');
    for (const n of [options.pollIntervalMs ?? 2000, options.timeoutMs ?? 300000])
      if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid Tripo timing');
  }
  async uploadImage(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<string> {
    if (!this.options.key) throw new Error('Set TRIPO_API_KEY');
    if (!/\.(png|jpe?g)$/i.test(name) || !bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new Error('Tripo reference must be PNG/JPEG, at most 20 MiB');
    const hash = digest(bytes),
      scope = digest(`${this.base}:${hash}`),
      path = join(this.options.cacheRoot, `image-${scope}.json`);
    await mkdir(this.options.cacheRoot, { recursive: true });
    try {
      return z
        .string()
        .regex(/^file_[a-zA-Z0-9_-]+$/)
        .parse(JSON.parse(await readFile(path, 'utf8')).token);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)]), name);
    const response = await fetch(this.base + '/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.key}` },
      body: form,
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]),
    });
    if (!response.ok) throw new Error(`Tripo image upload HTTP ${response.status}`);
    const body = (await response.json()) as { code: number; data?: { file_token?: string } };
    if (body.code !== 0) throw new Error(`Tripo upload error ${body.code}`);
    const token = z
      .string()
      .regex(/^file_[a-zA-Z0-9_-]+$/)
      .parse(body.data?.file_token);
    await atomic(path, JSON.stringify({ version: 1, sha256: hash, token }));
    return token;
  }
  generate(
    input: z.input<typeof TripoRequest>,
    signal?: AbortSignal,
    resumeTaskId?: string,
  ): Promise<TripoResult> {
    const request = TripoRequest.parse(input);
    const hash = digest(
      JSON.stringify({
        adapter: 1,
        base: this.base,
        model: this.model,
        request,
      }),
    );
    const existing = this.inflight.get(hash);
    if (existing) return existing;
    const job = this.run(request, hash, signal, resumeTaskId).finally(() =>
      this.inflight.delete(hash),
    );
    this.inflight.set(hash, job);
    return job;
  }
  private async run(
    request: z.infer<typeof TripoRequest>,
    hash: string,
    inputSignal?: AbortSignal,
    resumeTaskId?: string,
  ): Promise<TripoResult> {
    if (!this.options.key) throw new Error('Set TRIPO_API_KEY to generate assets');
    if (resumeTaskId && !/^[a-zA-Z0-9_-]{1,200}$/.test(resumeTaskId))
      throw new Error('Invalid task ID');
    const signal = AbortSignal.any([
      ...(inputSignal ? [inputSignal] : []),
      AbortSignal.timeout(this.options.timeoutMs ?? 300000),
    ]);
    signal.throwIfAborted();
    await mkdir(this.options.cacheRoot, { recursive: true });
    await mkdir(this.options.sourceRoot, { recursive: true });
    const path = join(this.options.cacheRoot, `${hash}.json`),
      lockPath = join(this.options.cacheRoot, `${hash}.lock`);
    let lock;
    try {
      lock = await open(lockPath, 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          `Tripo job ${hash} is locked by another process. Inspect its ledger before recovery.`,
        );
      throw e;
    }
    try {
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      let job: Job;
      try {
        job = Ledger.parse(JSON.parse(await readFile(path, 'utf8')));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const now = new Date().toISOString();
        job = {
          version: 1,
          requestHash: hash,
          provider: 'tripo-v3',
          model: this.model,
          request,
          phase: 'creating',
          createdAt: now,
          updatedAt: now,
        };
      }
      const save = async () => {
        job.updatedAt = new Date().toISOString();
        await atomic(path, JSON.stringify(job, null, 2) + '\n');
      };
      const result = (cacheHit: boolean): TripoResult => ({
        provider: 'tripo-v3',
        model: job.model,
        requestHash: hash,
        taskId: job.taskId!,
        sourcePath: join(this.options.sourceRoot, `${job.sha256}.glb`),
        sha256: job.sha256!,
        bytes: job.bytes!,
        cacheHit,
      });
      if (job.phase === 'success' && job.sha256) {
        try {
          const bytes = await readFile(result(true).sourcePath);
          if (digest(bytes) === job.sha256) return result(true);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      if (resumeTaskId) {
        if (job.taskId && job.taskId !== resumeTaskId)
          throw new Error('Ledger already refers to a different task');
        job.taskId = resumeTaskId;
        job.phase = 'polling';
        await save();
      }
      if (job.phase === 'failed')
        throw new Error(`Tripo task ${job.taskId} failed; no task was recreated`);
      if (!job.taskId) {
        // The durable marker precedes the paid POST. A process crash cannot become an automatic re-bill.
        let exists = false;
        try {
          await readFile(path);
          exists = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (exists)
          throw new Error(
            `Tripo task creation is uncertain (${hash}); recover its task ID from the provider console using --task-id`,
          );
        await save();
        try {
          const payload = {
            model: this.model,
            texture: true,
            pbr: true,
            face_limit: request.faceLimit,
            ...(request.seed === undefined ? {} : { model_seed: request.seed }),
            ...(request.image ? { input: request.image } : { prompt: request.prompt }),
          };
          const data = await this.api(
            `/generation/${request.image ? 'image' : 'text'}-to-model`,
            signal,
            { method: 'POST', body: JSON.stringify(payload) },
          );
          job.taskId = z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,200}$/)
            .parse(data.task_id);
          job.phase = 'polling';
          await save();
        } catch {
          throw new Error(
            `Tripo task creation is uncertain (${hash}); POST was not retried. Recover using --task-id.`,
          );
        }
      }
      const maxPolls =
        Math.ceil((this.options.timeoutMs ?? 300000) / (this.options.pollIntervalMs ?? 2000)) + 1;
      for (let poll = 0; poll < maxPolls; poll++) {
        signal.throwIfAborted();
        const task = await this.readTask(job.taskId!, signal);
        if (['failed', 'cancelled', 'banned'].includes(task.status)) {
          job.phase = 'failed';
          await save();
          throw new Error(`Tripo task ${job.taskId} ${task.status}`);
        }
        if (task.status === 'success') {
          const url = z.string().url().parse(task.output?.model_url);
          if (!/^https?:\/\//.test(url)) throw new Error('Invalid Tripo download URL');
          // Signed CDN URLs do not receive the API key.
          const response = await fetch(url, { signal });
          if (!response.ok)
            throw new Error(`Tripo model download HTTP ${response.status}; task preserved`);
          const bytes = await readLimited(response, signal);
          job.sha256 = digest(bytes);
          job.bytes = bytes.length;
          await atomic(join(this.options.sourceRoot, `${job.sha256}.glb`), bytes);
          job.phase = 'success';
          await save();
          return result(false);
        }
        if (!['queued', 'running', 'pending'].includes(task.status))
          throw new Error(`Unknown Tripo status: ${String(task.status)}`);
        await delay(this.options.pollIntervalMs ?? 2000, undefined, { signal });
      }
      throw new Error('Tripo polling limit exceeded; task preserved');
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  private async api(path: string, signal: AbortSignal, init: RequestInit = {}) {
    const response = await fetch(this.base + path, {
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.key}` },
    });
    if (!response.ok)
      throw Object.assign(new Error(`Tripo HTTP ${response.status}`), {
        retryable: response.status === 429 || response.status >= 500,
      });
    const body = (await response.json()) as { code: number; data: any };
    if (body.code !== 0 || !body.data) throw new Error(`Tripo error code ${body.code}`);
    return body.data;
  }
  private async readTask(id: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.api(`/tasks/${encodeURIComponent(id)}`, signal);
      } catch (e) {
        if (signal.aborted || attempt === 2 || (!(e as any).retryable && !(e instanceof TypeError)))
          throw e;
        await delay(
          Math.min(this.options.pollIntervalMs ?? 2000, 1000) * (attempt + 1),
          undefined,
          { signal },
        );
      }
    }
    throw new Error('Unreachable');
  }
}
