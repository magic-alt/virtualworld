import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generateWorld } from '@virtualworld/scene-builder/generate';
import { atomicWrite } from '@virtualworld/scene-builder/pipeline';
import type { LlmConfig } from '@virtualworld/planner';
import {
  GenerationInput,
  RequestId,
  type GenerationJob,
  type GenerationPhase,
} from '../shared/generation';
import { HttpError } from './store';
type RetainedJob = GenerationJob & {
  providers?: {
    llm: { baseUrl: string; model: string };
    tripo: { baseUrl: string; model: string };
  };
};

export class GenerationService {
  private jobs = new Map<string, RetainedJob>();
  private writes: Promise<unknown> = Promise.resolve();
  private work: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  constructor(
    private dataRoot: string,
    private projectRoot: string,
    private llm: LlmConfig,
  ) {}
  capabilities() {
    return {
      llm: !!(this.llm.baseUrl && this.llm.key && this.llm.model),
      tripo: !!process.env.TRIPO_API_KEY,
    };
  }
  private path(id: string) {
    return join(this.dataRoot, 'generations', `${RequestId.parse(id)}.json`);
  }
  private async persist(job: RetainedJob) {
    await atomicWrite(this.path(job.id), JSON.stringify(job, null, 2));
    this.jobs.set(job.id, job);
  }
  async init() {
    const directory = join(this.dataRoot, 'generations');
    await mkdir(directory, { recursive: true });
    await mkdir(join(this.dataRoot, 'references'), { recursive: true });
    for (const file of await readdir(directory)) {
      if (!/^[a-zA-Z0-9_-]{8,80}\.json$/.test(file)) continue;
      const record = JSON.parse(await readFile(join(directory, file), 'utf8')) as GenerationJob;
      record.input = GenerationInput.parse(record.input);
      if (
        record.id !== record.input.requestId ||
        file !== `${record.id}.json` ||
        record.worldId !== `world-${record.id}`
      )
        throw new Error('Invalid generation record identity');
      if (!['complete', 'failed', 'interrupted'].includes(record.phase)) {
        record.phase = 'interrupted';
        record.error = '服务已重启。任务不会自动重试；请检查已有记录后恢复。';
        record.updatedAt = new Date().toISOString();
        await this.persist(record);
      } else this.jobs.set(record.id, record);
    }
  }
  get(id: string) {
    RequestId.parse(id);
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, '生成任务不存在');
    const { providers: _providers, ...publicJob } = structuredClone(job);
    return publicJob;
  }
  async upload(name: string, bytes: Buffer) {
    const png =
      bytes.length > 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg =
      bytes.length > 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217;
    if (
      !/^[^/\\\x00-\x1f]{1,200}\.(png|jpe?g)$/i.test(name) ||
      bytes.length > 20 * 1024 * 1024 ||
      (!png && !jpg)
    )
      throw new HttpError(400, '参考图必须为 PNG/JPEG，最大 20 MiB');
    const id = createHash('sha256').update(bytes).digest('hex') + (png ? '.png' : '.jpg');
    await atomicWrite(join(this.dataRoot, 'references', id), bytes);
    return { id };
  }
  create(raw: unknown) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const input = GenerationInput.parse(raw),
          existing = this.jobs.get(input.requestId);
        if (existing) {
          if (JSON.stringify(existing.input) !== JSON.stringify(input))
            throw new HttpError(409, '请求 ID 已用于不同内容');
          return this.get(existing.id);
        }
        const capabilities = this.capabilities();
        if (input.planner === 'llm' && !capabilities.llm)
          throw new HttpError(400, 'AI 服务尚未配置');
        if (input.assets === 'tripo' && (!input.allowPaid || !capabilities.tripo))
          throw new HttpError(400, '请配置 Tripo 并明确同意付费资产生成');
        if (input.referenceId) {
          if (input.planner !== 'llm') throw new HttpError(400, '参考图需要 AI 规划模式');
          try {
            await readFile(join(this.dataRoot, 'references', input.referenceId));
          } catch {
            throw new HttpError(400, '参考图不存在，请重新上传');
          }
        }
        const now = new Date().toISOString();
        const job: RetainedJob = {
          version: 1,
          id: input.requestId,
          worldId: `world-${input.requestId}`,
          input,
          phase: 'queued',
          createdAt: now,
          updatedAt: now,
          providers: {
            llm: { baseUrl: this.llm.baseUrl, model: this.llm.model },
            tripo: {
              baseUrl: process.env.TRIPO_BASE_URL || 'https://openapi.tripo3d.ai/v3',
              model: process.env.TRIPO_MODEL || 'v3.1-20260211',
            },
          },
        };
        await this.persist(job);
        this.enqueue(job);
        return this.get(job.id);
      });
    this.writes = operation;
    return operation;
  }
  resume(id: string, raw: unknown) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const recovery = z
          .object({
            taskId: z
              .string()
              .regex(/^[a-zA-Z0-9_-]{1,200}$/)
              .optional(),
            taskNodeId: z
              .string()
              .regex(/^[a-zA-Z0-9_-]{1,100}$/)
              .optional(),
          })
          .strict()
          .parse(raw);
        this.get(id);
        const job = structuredClone(this.jobs.get(id)!);
        if (!['failed', 'interrupted'].includes(job.phase)) return this.get(id);
        if (job.input.assets === 'tripo' && !job.providers)
          throw new HttpError(409, '原始服务标识缺失，请检查账本后使用 CLI 恢复任务');
        const next = {
          ...job,
          phase: 'queued' as const,
          error: undefined,
          updatedAt: new Date().toISOString(),
        };
        await this.persist(next);
        this.enqueue(next, recovery);
        return this.get(id);
      });
    this.writes = operation;
    return operation;
  }
  private enqueue(job: RetainedJob, recovery: { taskId?: string; taskNodeId?: string } = {}) {
    this.work = this.work
      .catch(() => {})
      .then(async () => {
        const phase = async (value: GenerationPhase, error?: string) => {
          job = { ...job, phase: value, error, updatedAt: new Date().toISOString() };
          await this.persist(job);
        };
        try {
          this.controller.signal.throwIfAborted();
          await generateWorld({
            root: this.projectRoot,
            id: job.worldId,
            description: job.input.description,
            planner: job.input.planner,
            assets: job.input.assets,
            llm: { ...this.llm, ...job.providers?.llm },
            tripo: { key: process.env.TRIPO_API_KEY || '', ...job.providers?.tripo },
            referenceImage: job.input.referenceId
              ? join(this.dataRoot, 'references', job.input.referenceId)
              : undefined,
            signal: this.controller.signal,
            onPhase: phase,
            ...recovery,
          });
          await phase('complete');
        } catch (error) {
          // Provider failures are surfaced as status messages; keys are never serialized.
          const message = error instanceof Error ? error.message : String(error);
          const safe = [this.llm.key, process.env.TRIPO_API_KEY]
            .filter((key): key is string => !!key)
            .reduce((s, key) => s.split(key).join('[redacted]'), message);
          await phase(this.controller.signal.aborted ? 'interrupted' : 'failed', safe);
        }
      });
  }
  async close() {
    this.controller.abort();
    await this.writes.catch(() => {});
    await this.work.catch(() => {});
  }
}
