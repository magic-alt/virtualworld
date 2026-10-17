import { z } from 'zod';
import { createHash } from 'node:crypto';
import { node, SceneSchema, assertScene, type SceneSpec } from '@virtualworld/scene-schema';
import { PlannerError, type LlmConfig } from './index';
export const AssetRequest = z
  .object({ nodeId: SceneSchema.shape.id, prompt: z.string().min(1).max(1024) })
  .strict();
export const PlanSchema = z
  .object({ scene: SceneSchema, assetRequests: z.array(AssetRequest).max(8) })
  .strict();
export type WorldPlan = z.infer<typeof PlanSchema>;
export type WorldInput = { id: string; description: string; referenceImage?: string };

export function validatePlan(input: unknown, id: string): WorldPlan {
  const plan = PlanSchema.parse(input),
    scene = assertScene(plan.scene);
  if (scene.id !== id || scene.mode !== 'world' || scene.assets.length)
    throw new Error('Planner must return requested world ID, world mode and no external assets');
  if (
    !scene.nodes.some((n) => n.collider?.shape === 'box') ||
    !scene.nodes.some((n) => n.interaction?.completes)
  )
    throw new Error('World requires a ground collider and a complete story');
  const ids = new Set<string>();
  for (const request of plan.assetRequests) {
    const target = scene.nodes.find((n) => n.id === request.nodeId);
    if (!target || target.kind !== 'mesh' || ids.has(target.id))
      throw new Error('Asset request must target a unique existing mesh');
    ids.add(target.id);
  }
  for (const n of scene.nodes) if (n.joint) n.joint.confirmed = false;
  return { ...plan, scene };
}
/** Explicit offline mode: deterministic procedural planning, not a simulated LLM. */
export function builtinPlan({ id, description }: WorldInput): WorldPlan {
  if (!description.trim() || description.length > 4000)
    throw new Error('Description must be 1..4000 characters');
  const hash = createHash('sha256').update(description).digest();
  const h = hash[0] / 255;
  const palette = ['#609eac', '#8b849f', '#af9b68', '#759889'];
  const color = palette[hash[1] % palette.length];
  const scene: SceneSpec = {
    version: 1,
    id,
    name: description.slice(0, 60),
    description,
    mode: 'world',
    revision: 0,
    assets: [],
    environment: {
      background: `#${Buffer.from(hash.subarray(2, 5).map((v) => 16 + (v % 25))).toString('hex')}`,
      lightIntensity: 2.4 + h,
      ambientIntensity: 1.4,
      fog: 0.012,
    },
    camera: { position: [17, 12, 19], target: [0, 1, 0] },
    spawn: [0, 1, 5],
    tasks: [
      { flag: 'met-keeper', label: '与向导交谈' },
      { flag: 'found-star', label: '找到遗失的星核' },
      { flag: 'sent-letter', label: '点亮归航星门' },
    ],
    nodes: [
      node('island', '岛屿岩层', 'rock', [0, -2, 0], [22, 4, 20], '#657585'),
      node('ground', '可行走地面', 'cylinder', [0, -0.3, 0], [21, 0.6, 20], color, {
        collider: { shape: 'box', size: [20, 0.6, 18] },
      }),
      node('keeper', '旅程向导', 'character', [-3, 0, 2], [0.7, 1.7, 0.7], '#ddbc8b', {
        interaction: {
          title: '旅程向导',
          text: `欢迎来到${description.slice(0, 80)}。找到右侧的星核，再前往北侧星门。`,
          gives: 'met-keeper',
        },
      }),
      node('star', '遗失的星核', 'crystal', [4, 0.8, 0], [0.8, 1.3, 0.8], '#ade8e8', {
        emissive: 0.5,
        interaction: {
          title: '星核',
          text: '你找到了星核。把它送到星门吧。',
          requires: ['met-keeper'],
          gives: 'found-star',
        },
      }),
      node('gate', '归航星门', 'arch', [0, 0, -5], [3.2, 4.5, 0.7], '#ddd1bc', {
        interaction: {
          title: '归航星门',
          text: '星门亮起，新的旅程正在等待你。',
          requires: ['found-star'],
          gives: 'sent-letter',
          completes: true,
        },
      }),
      ...Array.from({ length: 12 }, (_, i) => {
        const a = i * 2.399 + h,
          r = 6.5 + (hash[i + 8] % 20) / 10;
        return node(
          `decoration-${i}`,
          `景物 ${i + 1}`,
          hash[i + 10] % 2 ? 'tree' : 'rock',
          [Math.cos(a) * r, 0, Math.sin(a) * r],
          [1.1, 1.8 + (hash[i + 12] % 10) / 5, 1.1],
          color,
        );
      }),
    ],
  };
  return validatePlan(
    {
      scene,
      assetRequests: [
        {
          nodeId: 'star',
          prompt: `A low-poly collectible crystal artifact, isolated, ${description.slice(0, 800)}`,
        },
      ],
    },
    id,
  );
}
export async function planWorld(
  input: WorldInput,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<WorldPlan> {
  SceneSchema.shape.id.parse(input.id);
  z.string().min(1).max(4000).parse(input.description);
  if (!config.baseUrl || !config.model || !config.key)
    throw new PlannerError(
      503,
      'Set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY; use --planner builtin for offline procedural generation',
    );
  const system = `Plan a complete original playable 3D world. Return JSON only: {scene:SceneSpec,assetRequests:[{nodeId,prompt}]}. SceneSpec v1 uses metres, Y-up, radians; supported shapes box,cylinder,sphere,cone,torus,rock,crystal,tree,arch,character. No scripts, URLs or external assets. Keep assets empty; assetRequests target at most 8 unique mesh node IDs, excluding floor. Include a broad floor with box collider, reachable spawn, NPC, collectible, goal, task flags with reachable prerequisites and a completing interaction. Fixed flat terrain, no spherical movement. Use visible:true, positive size/scale and color hex. All inferred joint.confirmed must be false. Return scene id exactly ${input.id}, revision:0, mode:world. Example complete data shape: ${JSON.stringify(builtinPlan(input))}. Create a distinct layout and story based on the user's description; do not just rename the example.`;
  const content: unknown = input.referenceImage
    ? [
        { type: 'text', text: input.description },
        { type: 'image_url', image_url: { url: input.referenceImage } },
      ]
    : input.description;
  const messages: { role: string; content: unknown }[] = [
    { role: 'system', content: system },
    { role: 'user', content },
  ];
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90000)]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.3 }),
      signal: combined,
    });
    if (!response.ok) throw new PlannerError(502, `Planner HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content || '';
    try {
      return validatePlan(
        JSON.parse(
          raw
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, ''),
        ),
        input.id,
      );
    } catch (e) {
      if (attempt === 1)
        throw new PlannerError(
          422,
          'Planner returned two invalid world plans; no world was published',
        );
      messages.push(
        { role: 'assistant', content: raw.slice(0, 40000) },
        {
          role: 'user',
          content: `Repair invalid plan: ${String(e).slice(0, 3000)}. Return complete JSON.`,
        },
      );
    }
  }
  throw new Error('Unreachable');
}
