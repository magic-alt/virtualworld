import { z } from 'zod';
import { assertScene, SceneSchema, NodeSchema, type SceneSpec } from '@virtualworld/scene-schema';

export { node } from '@virtualworld/scene-schema';
export { groupCommands } from './assemble-import';
export const WorldSceneSchema = SceneSchema.omit({ assets: true, tasks: true })
  .extend({
    nodes: z.array(NodeSchema.omit({ interaction: true })).max(5000),
  })
  .strict();
export const WorldStorySchema = z
  .object({
    version: z.literal(1),
    worldId: SceneSchema.shape.id,
    tasks: SceneSchema.shape.tasks,
    interactions: z.record(NodeSchema.shape.interaction.unwrap()),
  })
  .strict();
export const WorldAssetsSchema = z
  .object({
    version: z.literal(1),
    worldId: SceneSchema.shape.id,
    assets: SceneSchema.shape.assets,
  })
  .strict();
export type WorldBundle = ReturnType<typeof splitWorld>;
export function assembleWorld(
  sceneInput: unknown,
  storyInput: unknown,
  assetsInput: unknown,
): SceneSpec {
  const scene = WorldSceneSchema.parse(sceneInput);
  const story = WorldStorySchema.parse(storyInput);
  const assets = WorldAssetsSchema.parse(assetsInput);
  if (story.worldId !== scene.id || assets.worldId !== scene.id)
    throw new Error('World document IDs do not match');
  for (const id of Object.keys(story.interactions)) {
    if (!scene.nodes.some((n) => n.id === id)) throw new Error(`Unknown story node: ${id}`);
  }
  return assertScene({
    ...scene,
    assets: assets.assets,
    tasks: story.tasks,
    nodes: scene.nodes.map((n) => ({
      ...n,
      ...(story.interactions[n.id] ? { interaction: story.interactions[n.id] } : {}),
    })),
  });
}
export function splitWorld(input: SceneSpec) {
  const { assets, tasks, nodes, ...properties } = structuredClone(assertScene(input));
  const interactions: Record<string, NonNullable<SceneSpec['nodes'][number]['interaction']>> = {};
  const geometry = nodes.map(({ interaction, ...n }) => {
    if (interaction) interactions[n.id] = interaction;
    return n;
  });
  return {
    scene: { ...properties, nodes: geometry },
    story: { version: 1 as const, worldId: input.id, tasks, interactions },
    assets: { version: 1 as const, worldId: input.id, assets },
  };
}
