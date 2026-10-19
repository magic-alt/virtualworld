import { resolve, join } from 'node:path';
import { z } from 'zod';

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const HostedPolicy = z
  .object({
    mode: z.literal('hosted'),
    publicOrigin: z.string().refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
      } catch {
        return false;
      }
    }, 'VW_PUBLIC_ORIGIN must be an exact HTTPS origin without a path or credentials'),
    gatewaySecret: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{32,256}$/,
        'VW_GATEWAY_SECRET must contain 32..256 URL-safe random characters',
      ),
  })
  .strict();
export const AccessPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local'), port: z.number().int().min(1).max(65535) }).strict(),
  HostedPolicy,
]);
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;
export type ServiceLimits = {
  maxPendingGenerations: number;
  maxAgentRequests: number;
  maxExports: number;
  maxExportBytes: number;
};
export const DEFAULT_LIMITS: ServiceLimits = {
  maxPendingGenerations: 8,
  maxAgentRequests: 2,
  maxExports: 1,
  maxExportBytes: 256 * 1024 * 1024,
};
export function serviceLimits(overrides: Partial<ServiceLimits> = {}): ServiceLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid service limit: ${key}`);
  return limits;
}
function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > max)
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  return number;
}
/** Environment configuration belongs to startup; createApp remains deterministic for callers. */
export function readServerConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = z.enum(['local', 'hosted']).parse(env.VW_SERVER_MODE || 'local');
  const port = integer(env.PORT, 3001, 'PORT', 65535);
  const host = env.VW_HOST || (mode === 'hosted' ? '0.0.0.0' : '127.0.0.1');
  if (mode === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error(
      'Local mode must bind loopback. Configure authenticated hosted mode for remote access.',
    );
  if (mode === 'hosted' && !env.VW_DATA_ROOT?.trim())
    throw new Error('Hosted mode requires VW_DATA_ROOT on persistent storage');
  const accessPolicy = AccessPolicySchema.parse(
    mode === 'local'
      ? { mode, port }
      : { mode, publicOrigin: env.VW_PUBLIC_ORIGIN, gatewaySecret: env.VW_GATEWAY_SECRET },
  );
  // Preserve the historical local layout when no override is present. createApp
  // uses data/ for project records and the repository asset library for uploads.
  const dataRoot = env.VW_DATA_ROOT ? resolve(env.VW_DATA_ROOT) : undefined;
  return {
    host,
    port,
    dataRoot,
    accessPolicy,
    generatedRoot: mode === 'hosted' ? join(dataRoot!, 'workspace') : undefined,
    limits: serviceLimits({
      maxPendingGenerations: integer(
        env.VW_MAX_PENDING_GENERATIONS,
        8,
        'VW_MAX_PENDING_GENERATIONS',
        1000,
      ),
      maxAgentRequests: integer(env.VW_MAX_AGENT_REQUESTS, 2, 'VW_MAX_AGENT_REQUESTS', 32),
      maxExports: integer(env.VW_MAX_EXPORTS, 1, 'VW_MAX_EXPORTS', 8),
      maxExportBytes: integer(env.VW_MAX_EXPORT_MIB, 256, 'VW_MAX_EXPORT_MIB', 2048) * 1024 * 1024,
    }),
  };
}
