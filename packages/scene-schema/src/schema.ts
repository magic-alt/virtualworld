import { z } from 'zod';

export const Vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const AssetSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(200),
    type: z.enum(['glb', 'splat']),
    url: z
      .string()
      .regex(/^(\/api\/assets\/|\/fixtures\/|\/assets\/optimized\/|assets\/)[a-zA-Z0-9_.\/-]+$/),
    bytes: z.number().int().nonnegative(),
    source: z.string().max(500).optional(),
  })
  .strict();
export const NodeSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(200),
    kind: z.enum(['group', 'mesh', 'splat', 'light']),
    parentId: identifier.optional(),
    assetId: identifier.optional(),
    assetNode: z
      .string()
      .regex(/^(\d+(\.\d+)*)?$/)
      .optional(),
    materialOverride: z.boolean().optional(),
    shape: z
      .enum([
        'box',
        'cylinder',
        'sphere',
        'torus',
        'cone',
        'rock',
        'crystal',
        'tree',
        'arch',
        'character',
        'glb',
      ])
      .optional(),
    position: Vec3,
    rotation: Vec3,
    scale: Vec3.refine((v) => v.every((n) => n > 0), 'Scale must be positive'),
    size: Vec3.refine((v) => v.every((n) => n > 0), 'Size must be positive'),
    color,
    visible: z.boolean(),
    metalness: z.number().min(0).max(1).optional(),
    roughness: z.number().min(0).max(1).optional(),
    emissive: z.number().min(0).max(10).optional(),
    opacity: z.number().min(0).max(1).optional(),
    collider: z
      .object({ shape: z.enum(['box', 'ball']), size: Vec3.refine((v) => v.every((n) => n > 0)) })
      .strict()
      .optional(),
    explode: Vec3.optional(),
    joint: z
      .object({
        axis: z.enum(['x', 'y', 'z']),
        min: z.number().finite(),
        max: z.number().finite(),
        value: z.number().finite(),
        confirmed: z.boolean(),
      })
      .strict()
      .optional(),
    interaction: z
      .object({
        title: z.string().max(200),
        text: z.string().max(4000),
        requires: z.array(identifier).max(100).optional(),
        gives: identifier.optional(),
        completes: z.boolean().optional(),
        choices: z
          .array(z.object({ label: z.string().max(100), text: z.string().max(2000) }).strict())
          .max(10)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const EnvironmentSchema = z
  .object({
    background: color,
    lightIntensity: z.number().min(0).max(20),
    ambientIntensity: z.number().min(0).max(10),
    fog: z.number().min(0).max(0.2).optional(),
  })
  .strict();
export const SceneSchema = z
  .object({
    version: z.literal(1),
    id: identifier,
    name: z.string().min(1).max(200),
    description: z.string().max(4000),
    mode: z.enum(['industrial', 'world']),
    revision: z.number().int().nonnegative(),
    assets: z.array(AssetSchema).max(1000),
    nodes: z.array(NodeSchema).max(5000),
    environment: EnvironmentSchema,
    camera: z.object({ position: Vec3, target: Vec3 }).strict(),
    spawn: Vec3,
    tasks: z.array(z.object({ flag: identifier, label: z.string().max(200) }).strict()).max(100),
  })
  .strict();
export type SceneSpec = z.infer<typeof SceneSchema>;
export type SceneNode = z.infer<typeof NodeSchema>;
export type SceneAsset = z.infer<typeof AssetSchema>;
export type Vector3Tuple = z.infer<typeof Vec3>;

export function validateScene(input: unknown): string[] {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
  const scene = parsed.data,
    errors: string[] = [];
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  const assets = new Map(scene.assets.map((a) => [a.id, a]));
  if (nodes.size !== scene.nodes.length) errors.push('对象 ID 重复');
  if (assets.size !== scene.assets.length) errors.push('资源 ID 重复');
  for (const node of scene.nodes) {
    if (node.parentId && !nodes.has(node.parentId)) errors.push(`${node.name}: 父对象不存在`);
    if (node.assetId && !assets.has(node.assetId)) errors.push(`${node.name}: 资源不存在`);
    if ((node.kind === 'splat' || node.shape === 'glb') && !node.assetId)
      errors.push(`${node.name}: 缺少资源引用`);
    if (node.kind === 'splat' && node.assetId && assets.get(node.assetId)?.type !== 'splat')
      errors.push(`${node.name}: 错误的 Splat 资源类型`);
    if (node.shape === 'glb' && node.assetId && assets.get(node.assetId)?.type !== 'glb')
      errors.push(`${node.name}: 错误的 GLB 资源类型`);
    if (
      node.joint &&
      (node.joint.min > node.joint.max ||
        node.joint.value < node.joint.min ||
        node.joint.value > node.joint.max)
    )
      errors.push(`${node.name}: 关节范围无效`);
    const visited = new Set([node.id]);
    let parent = node.parentId;
    while (parent && nodes.has(parent)) {
      if (visited.has(parent)) {
        errors.push(`${node.name}: 层级循环 cycle`);
        break;
      }
      visited.add(parent);
      parent = nodes.get(parent)?.parentId;
    }
  }
  for (const asset of scene.assets)
    if (asset.url.split('/').includes('..')) errors.push(`${asset.name}: 非法资源路径`);
  const reachable = new Set<string>();
  let oldSize = -1;
  while (oldSize !== reachable.size) {
    oldSize = reachable.size;
    for (const n of scene.nodes) {
      const i = n.interaction;
      if (i?.gives && (!i.requires || i.requires.every((f) => reachable.has(f))))
        reachable.add(i.gives);
    }
  }
  for (const n of scene.nodes)
    if (n.interaction?.requires?.some((f) => !reachable.has(f)))
      errors.push(`${n.name}: 交互前置条件不可达`);
  for (const task of scene.tasks)
    if (!reachable.has(task.flag)) errors.push(`${task.label}: 任务标记无法获得`);
  if (new Set(scene.tasks.map((t) => t.flag)).size !== scene.tasks.length)
    errors.push('任务标记重复');
  return [...new Set(errors)];
}

export function assertScene(input: unknown): SceneSpec {
  const errors = validateScene(input);
  if (errors.length) throw new Error(errors.join('\n'));
  return SceneSchema.parse(input);
}
