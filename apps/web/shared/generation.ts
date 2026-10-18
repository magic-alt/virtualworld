import { z } from 'zod';
export const RequestId = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
export const GenerationInput = z
  .object({
    requestId: RequestId,
    description: z.string().trim().min(1).max(4000),
    planner: z.enum(['builtin', 'llm']),
    assets: z.enum(['builtin', 'tripo']),
    referenceId: z
      .string()
      .regex(/^[a-f0-9]{64}\.(png|jpg)$/)
      .optional(),
    allowPaid: z.boolean().default(false),
  })
  .strict();
export type GenerationRequest = z.infer<typeof GenerationInput>;
export type GenerationPhase =
  | 'queued'
  | 'planning'
  | 'assets'
  | 'validating'
  | 'complete'
  | 'failed'
  | 'interrupted';
export type GenerationJob = {
  version: 1;
  id: string;
  worldId: string;
  input: GenerationRequest;
  phase: GenerationPhase;
  createdAt: string;
  updatedAt: string;
  error?: string;
};
export type GenerationCapabilities = { llm: boolean; tripo: boolean };
export const phaseLabels: Record<GenerationPhase, string> = {
  queued: '等待生成',
  planning: '构思世界与故事',
  assets: '构建世界资产',
  validating: '校验与发布',
  complete: '世界已就绪',
  failed: '生成未完成',
  interrupted: '任务已中断，等待恢复',
};
