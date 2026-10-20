import { z } from 'zod';

export const nativeEngines = ['unity', 'unreal'] as const;
export type NativeEngine = (typeof nativeEngines)[number];
export type ExperienceEngine = 'web' | NativeEngine;
const RuntimeBinding = z
  .object({
    engine: z.enum(nativeEngines),
    sceneId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    revision: z.number().int().nonnegative(),
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Engine runtime URL must be an HTTP(S) URL without credentials'),
    default: z.boolean().optional(),
  })
  .strict();

export const EngineRuntimeRegistry = z
  .array(RuntimeBinding)
  .max(200)
  .superRefine((entries, ctx) => {
    const keys = new Set<string>();
    const defaults = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const key = `${entry.sceneId}:${entry.engine}`;
      if (keys.has(key) || (entry.default && defaults.has(entry.sceneId)))
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: 'Duplicate engine binding or default for a scene',
        });
      keys.add(key);
      if (entry.default) defaults.add(entry.sceneId);
    }
  });
export type EngineRuntimeBinding = z.infer<typeof RuntimeBinding>;
export const EngineCapabilities = z.object({
  sceneId: z.string(),
  revision: z.number().int().nonnegative(),
  defaultEngine: z.enum(['web', ...nativeEngines]),
  engines: z.array(
    z.object({
      id: z.enum(nativeEngines),
      status: z.enum(['configured', 'missing', 'stale']),
      url: z.string().optional(),
    }),
  ),
});
export type EngineCapabilities = z.infer<typeof EngineCapabilities>;

/** Configuration is an advertised deployment, never evidence that an engine is running. */
export function engineCapabilities(
  scene: { id: string; revision: number },
  registry: EngineRuntimeBinding[],
): EngineCapabilities {
  const bindings = registry.filter((binding) => binding.sceneId === scene.id);
  const preferred = bindings.find((binding) => binding.default);
  return {
    sceneId: scene.id,
    revision: scene.revision,
    defaultEngine: preferred?.engine ?? 'web',
    engines: nativeEngines.map((id) => {
      const binding = bindings.find((candidate) => candidate.engine === id);
      if (!binding) return { id, status: 'missing' };
      if (binding.revision !== scene.revision) return { id, status: 'stale' };
      return { id, status: 'configured', url: binding.url };
    }),
  };
}
