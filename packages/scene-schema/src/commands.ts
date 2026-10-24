import { z } from 'zod';
import {
  NodeSchema,
  AssetSchema,
  EnvironmentSchema,
  SceneSchema,
  assertScene,
  type SceneSpec,
} from './schema';
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addNode'), node: NodeSchema }).strict(),
  z
    .object({
      type: z.literal('updateNode'),
      id: z.string(),
      patch: NodeSchema.omit({ id: true }).partial().strict(),
    })
    .strict(),
  z.object({ type: z.literal('removeNode'), id: z.string() }).strict(),
  z.object({ type: z.literal('addAsset'), asset: AssetSchema }).strict(),
  z
    .object({ type: z.literal('setEnvironment'), patch: EnvironmentSchema.partial().strict() })
    .strict(),
  z.object({ type: z.literal('renameProject'), name: z.string().min(1).max(200) }).strict(),
  z
    .object({
      type: z.literal('configureScene'),
      patch: SceneSchema.pick({
        camera: true,
        spawn: true,
        tasks: true,
        description: true,
        mechanism: true,
      })
        .partial()
        .strict(),
    })
    .strict(),
]);
export type SceneCommand = z.infer<typeof CommandSchema>;
export function applyCommands(scene: SceneSpec, baseRevision: number, input: unknown[]): SceneSpec {
  if (baseRevision !== scene.revision)
    throw new Error('修订冲突 revision conflict，请重新生成提案');
  const commands = z.array(CommandSchema).min(1).max(5001).parse(input);
  const next = structuredClone(scene);
  for (const command of commands) {
    switch (command.type) {
      case 'addNode':
        if (next.nodes.some((n) => n.id === command.node.id)) throw new Error('对象 ID 已存在');
        next.nodes.push(command.node);
        break;
      case 'updateNode': {
        const node = next.nodes.find((n) => n.id === command.id);
        if (!node) throw new Error(`对象不存在: ${command.id}`);
        Object.assign(node, command.patch);
        break;
      }
      case 'removeNode': {
        if (!next.nodes.some((n) => n.id === command.id)) throw new Error('对象不存在');
        const remove = new Set([command.id]);
        let oldSize = 0;
        while (oldSize !== remove.size) {
          oldSize = remove.size;
          for (const n of next.nodes) if (n.parentId && remove.has(n.parentId)) remove.add(n.id);
        }
        next.nodes = next.nodes.filter((n) => !remove.has(n.id));
        break;
      }
      case 'addAsset':
        if (next.assets.some((a) => a.id === command.asset.id)) throw new Error('资源 ID 已存在');
        next.assets.push(command.asset);
        break;
      case 'setEnvironment':
        Object.assign(next.environment, command.patch);
        break;
      case 'renameProject':
        next.name = command.name;
        break;
      case 'configureScene':
        Object.assign(next, command.patch);
        break;
    }
  }
  next.revision++;
  return assertScene(next);
}
export class SceneHistory {
  private current: SceneSpec;
  private past: SceneSpec[] = [];
  private future: SceneSpec[] = [];
  constructor(scene: SceneSpec) {
    this.current = structuredClone(assertScene(scene));
  }
  get scene() {
    return this.current;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  apply(commands: SceneCommand[]) {
    const next = applyCommands(this.current, this.current.revision, commands);
    this.past.push(this.current);
    this.past = this.past.slice(-100);
    this.current = next;
    this.future = [];
    return next;
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.current);
      this.current = { ...previous, revision: this.current.revision + 1 };
    }
    return this.current;
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = { ...next, revision: this.current.revision + 1 };
    }
    return this.current;
  }
}
