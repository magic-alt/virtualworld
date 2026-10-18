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
    animation: z
      .object({
        clip: z.string().min(1).max(100),
        loop: z.boolean().optional(),
        speed: z.number().min(0).max(10).optional(),
      })
      .strict()
      .optional(),
    emissive: z.number().min(0).max(10).optional(),
    opacity: z.number().min(0).max(1).optional(),
    collider: z
      .object({
        shape: z.enum(['box', 'ball', 'mesh']),
        size: Vec3.refine((v) => v.every((n) => n > 0)),
      })
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
    navigation: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('plane') }).strict(),
        z
          .object({
            kind: z.literal('sphere'),
            center: Vec3,
            radius: z.number().finite().positive(),
          })
          .strict(),
      ])
      .optional(),
    actor: z
      .object({
        assetId: identifier,
        height: z.number().finite().min(0.1).max(5),
        clips: z.object({ idle: z.string(), walk: z.string(), interact: z.string() }).strict(),
      })
      .strict()
      .optional(),
    campaign: z
      .object({ id: identifier, chapterId: identifier, index: z.number().int().min(0) })
      .strict()
      .optional(),
    mechanism: z
      .object({
        kind: z.literal('harmonic'),
        waveNodeId: identifier,
        flexNodeId: identifier,
        outputNodeId: identifier,
        fixedNodeIds: z.array(identifier),
        flexTeeth: z.number().int().min(10),
        ringTeeth: z.number().int().min(10),
        cosMorph: z.string().min(1),
        sinMorph: z.string().min(1),
        fullHousingIds: z.array(identifier),
        sectionHousingIds: z.array(identifier),
        dimensions: z
          .object({
            baseDiameter: z.number().positive(),
            housingDiameter: z.number().positive(),
            totalHeight: z.number().positive(),
            boreDiameter: z.number().positive(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SceneSpec = z.infer<typeof SceneSchema>;
export type SceneNode = z.infer<typeof NodeSchema>;
export type SceneAsset = z.infer<typeof AssetSchema>;
export type Vector3Tuple = z.infer<typeof Vec3>;
export const CampaignSchema = z
  .object({
    version: z.literal(1),
    id: identifier,
    title: z.string().min(1).max(200),
    description: z.string().max(4000),
    chapters: z
      .array(
        z
          .object({
            id: identifier,
            title: z.string().min(1).max(200),
            directory: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
            requires: z.array(identifier).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const chapter of value.chapters) {
      if (seen.has(chapter.id) || (chapter.requires || []).some((id) => !seen.has(id)))
        ctx.addIssue({
          code: 'custom',
          message: 'Chapter IDs must be unique and prerequisites must precede them',
        });
      seen.add(chapter.id);
    }
  });
export type CampaignSpec = z.infer<typeof CampaignSchema>;

export function validateScene(input: unknown): string[] {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
  const scene = parsed.data,
    errors: string[] = [];
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  const assets = new Map(scene.assets.map((a) => [a.id, a]));
  if (nodes.size !== scene.nodes.length) errors.push('对象 ID 重复');
  if (assets.size !== scene.assets.length) errors.push('资源 ID 重复');
  if (scene.actor && assets.get(scene.actor.assetId)?.type !== 'glb')
    errors.push('角色必须引用存在的 GLB 资源');
  if (scene.campaign && scene.campaign.chapterId !== scene.id) errors.push('章节 ID 与场景不一致');
  if (scene.mechanism) {
    const m = scene.mechanism;
    for (const id of [
      m.waveNodeId,
      m.flexNodeId,
      m.outputNodeId,
      ...m.fixedNodeIds,
      ...m.fullHousingIds,
      ...m.sectionHousingIds,
    ])
      if (!nodes.has(id)) errors.push(`机构引用不存在: ${id}`);
    if (m.ringTeeth - m.flexTeeth !== 2) errors.push('双波谐波传动要求刚轮比柔轮多两齿');
    if (new Set([m.waveNodeId, m.flexNodeId, m.outputNodeId]).size !== 3)
      errors.push('机构运动件必须独立');
    if (m.fixedNodeIds.some((id) => [m.waveNodeId, m.flexNodeId, m.outputNodeId].includes(id)))
      errors.push('机构固定件不能同时是运动件');
    const moving = new Set([m.waveNodeId, m.flexNodeId, m.outputNodeId]);
    for (const id of [...moving, ...m.fixedNodeIds]) {
      const visited = new Set<string>();
      let parent = nodes.get(id)?.parentId;
      while (parent && !visited.has(parent)) {
        if (moving.has(parent)) {
          errors.push('机构运动根节点必须独立，固定件不能处于运动件下');
          break;
        }
        visited.add(parent);
        parent = nodes.get(parent)?.parentId;
      }
    }
    const d = m.dimensions;
    if (d.boreDiameter >= d.housingDiameter || d.housingDiameter > d.baseDiameter)
      errors.push('通孔、壳体和底座直径关系无效');
  }
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
