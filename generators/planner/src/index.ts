import { z } from 'zod';
import { SceneSchema, NodeSchema, assertScene } from '@virtualworld/scene-schema';
import { CommandSchema, applyCommands } from '@virtualworld/scene-schema';
export class PlannerError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export type LlmConfig = { baseUrl: string; model: string; key: string };
export const AgentInput = z
  .object({
    scene: SceneSchema,
    prompt: z.string().min(1).max(8000),
    selectedId: z.string().optional(),
  })
  .strict();
const Proposal = z
  .object({
    summary: z.string().min(1).max(2000),
    commands: z.array(CommandSchema).min(1).max(200),
  })
  .strict();
export async function propose(
  input: z.infer<typeof AgentInput>,
  config: LlmConfig,
  signal?: AbortSignal,
) {
  const { scene, prompt, selectedId } = AgentInput.parse(input);
  assertScene(scene);
  if (!config.baseUrl || !config.model || !config.key)
    throw new PlannerError(
      503,
      '尚未配置 AI 接口，请在 .env 设置 LLM_BASE_URL、LLM_MODEL、LLM_API_KEY',
    );
  const endpoint = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const nodeShape = {
    id: 'new-object-id',
    name: '对象名称',
    kind: 'mesh',
    shape: 'box',
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    size: [1, 1, 1],
    color: '#88aaff',
    visible: true,
  };
  const system = `You edit SceneSpec v1 for a 3D studio. Return ONLY JSON {"summary":"Chinese explanation","commands":[...]}. Never return scripts, JS, external asset URLs, markdown or tools. Work in metres, Y up, radians. Preserve unrelated objects and IDs. Use existing asset IDs or primitive shapes. Allowed commands: {type:"updateNode",id,patch}, {type:"addNode",node}, {type:"removeNode",id}, {type:"setEnvironment",patch}, {type:"renameProject",name}. Node example: ${JSON.stringify(nodeShape)}. Shapes: box,cylinder,sphere,torus,cone,rock,crystal,tree,arch,character,glb. Optional node properties: parentId,assetId,metalness,roughness,emissive,opacity,explode:[x,y,z],collider:{shape:"box"|"ball",size:[x,y,z]},joint:{axis:"x"|"y"|"z",min,max,value,confirmed:false},interaction:{title,text,requires?:string[],gives?:string,completes?:boolean,choices?:[{label,text}]}. Environment properties: background hex, lightIntensity 0..20, ambientIntensity 0..10, fog 0..0.2. Use only supported fields. Any inferred joint must have confirmed:false. Never claim engineering accuracy.`;
  const messages: { role: string; content: string }[] = [
    {
      role: 'system',
      content:
        system +
        ' Also allowed: {type:"configureScene",patch:{camera?:{position:[x,y,z],target:[x,y,z]},spawn?:[x,y,z],tasks?:[{flag,label}],description?:string}}. Story journal task flags and all prerequisites must be reachable from interaction.gives in the same final scene. For a new world include a floor collider, an accessible spawn, interactions, tasks and a suitable camera.',
    },
    { role: 'user', content: JSON.stringify({ instruction: prompt, selectedId, scene }) },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    });
    if (!response.ok)
      throw new PlannerError(502, `模型服务返回 HTTP ${response.status}，请检查接口配置或额度`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content || '';
    try {
      const clean = content
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      const proposal = Proposal.parse(JSON.parse(clean));
      for (const c of proposal.commands) {
        if (c.type === 'addNode' && c.node.joint) c.node.joint.confirmed = false;
        if (c.type === 'updateNode' && c.patch.joint) c.patch.joint.confirmed = false;
      }
      applyCommands(scene, scene.revision, proposal.commands);
      // Schema validation above also keeps model-proposed properties from becoming executable code.
      return { ...proposal, projectId: scene.id, baseRevision: scene.revision };
    } catch (error) {
      if (attempt === 1) throw new PlannerError(422, '模型两次返回无效场景命令，原场景未改变');
      messages.push(
        { role: 'assistant', content: content.slice(0, 30000) },
        {
          role: 'user',
          content: `Invalid proposal: ${String(error).slice(0, 3000)}. Repair and return only the complete JSON proposal.`,
        },
      );
    }
  }
  throw new Error('Unreachable');
}
