import type { SceneSpec } from '@virtualworld/scene-schema';
export type StoryState = { flags: string[]; message: string; completed: boolean };
export const initialStory = (): StoryState => ({ flags: [], message: '', completed: false });
export function advanceStory(scene: SceneSpec, state: StoryState, nodeId: string): StoryState {
  const interaction = scene.nodes.find((n) => n.id === nodeId)?.interaction;
  if (!interaction) return state;
  if (interaction.requires?.some((flag) => !state.flags.includes(flag)))
    return { ...state, message: '还有一段旅程等待完成。先看看左侧的任务清单。' };
  return {
    flags: [...new Set([...state.flags, ...(interaction.gives ? [interaction.gives] : [])])],
    message: interaction.text,
    completed: state.completed || !!interaction.completes,
  };
}
