import type { SceneNode, SceneSpec } from '@virtualworld/scene-schema';
export type StoryState = { flags: string[]; message: string; completed: boolean };
export const initialStory = (): StoryState => ({ flags: [], message: '', completed: false });
/** Shared by nearby selection and explicit controls; completed encounters remain replayable. */
export function interactionStatus(
  node: SceneNode,
  state: StoryState,
): 'none' | 'locked' | 'available' | 'completed' {
  const interaction = node.interaction;
  if (!interaction) return 'none';
  if (interaction.requires?.some((flag) => !state.flags.includes(flag))) return 'locked';
  if (interaction.gives && state.flags.includes(interaction.gives)) return 'completed';
  return 'available';
}
export function advanceStory(scene: SceneSpec, state: StoryState, nodeId: string): StoryState {
  const interaction = scene.nodes.find((n) => n.id === nodeId)?.interaction;
  if (!interaction) return state;
  if (interaction.requires?.some((flag) => !state.flags.includes(flag)))
    return { ...state, message: '还有一段旅程等待完成。请先完成前置任务，再回到这里。' };
  return {
    flags: [...new Set([...state.flags, ...(interaction.gives ? [interaction.gives] : [])])],
    message: interaction.text,
    completed: state.completed || !!interaction.completes,
  };
}
