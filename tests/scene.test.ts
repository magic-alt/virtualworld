import { describe, it, expect } from 'vitest';
import { validateScene } from '../packages/scene/src/schema';
import { applyCommands, SceneHistory } from '../packages/scene/src/commands';
import { advanceStory } from '../packages/scene/src/story';

export const sample = (): any => ({
  version: 1,
  id: 'sample',
  name: 'Sample',
  description: '',
  mode: 'world',
  revision: 0,
  assets: [],
  nodes: [
    {
      id: 'ground',
      name: 'Ground',
      kind: 'mesh',
      shape: 'box',
      position: [0, -0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [20, 1, 20],
      color: '#ffffff',
      visible: true,
    },
    {
      id: 'guide',
      name: 'Guide',
      kind: 'mesh',
      shape: 'sphere',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [1, 1, 1],
      color: '#ffffff',
      visible: true,
      interaction: { title: 'Guide', text: 'Find the star', gives: 'met-guide' },
    },
    {
      id: 'star',
      name: 'Star',
      kind: 'mesh',
      shape: 'sphere',
      position: [2, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [1, 1, 1],
      color: '#ffffff',
      visible: true,
      interaction: { title: 'Star', text: 'Collected', requires: ['met-guide'], gives: 'star' },
    },
    {
      id: 'gate',
      name: 'Gate',
      kind: 'mesh',
      shape: 'box',
      position: [5, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [1, 1, 1],
      color: '#ffffff',
      visible: true,
      interaction: { title: 'Home', text: 'Complete', requires: ['star'], completes: true },
    },
  ],
  environment: { background: '#101828', lightIntensity: 2, ambientIntensity: 1 },
  camera: { position: [8, 6, 8], target: [0, 0, 0] },
  spawn: [0, 1, 5],
  tasks: [
    { flag: 'met-guide', label: 'Meet guide' },
    { flag: 'star', label: 'Find star' },
  ],
});

describe('scene transactions', () => {
  it('configures a portable camera, spawn point and reachable task journal', () => {
    const next = applyCommands(sample(), 0, [
      {
        type: 'configureScene',
        patch: {
          camera: { position: [3, 4, 5], target: [0, 1, 0] },
          spawn: [1, 2, 3],
          tasks: [{ flag: 'star', label: 'Find the star' }],
        },
      },
    ]);
    expect(next.camera.position).toEqual([3, 4, 5]);
    expect(next.spawn).toEqual([1, 2, 3]);
    expect(next.tasks).toEqual([{ flag: 'star', label: 'Find the star' }]);
  });
  it('imports an assembly with more than 200 nodes as one atomic transaction', () => {
    const scene = sample();
    const commands = Array.from({ length: 250 }, (_, i) => ({
      type: 'addNode',
      node: { ...scene.nodes[0], id: `part-${i}`, name: `Part ${i}` },
    }));
    const next = applyCommands(scene, 0, commands);
    expect(next.nodes).toHaveLength(254);
    expect(next.revision).toBe(1);
  });
  it('accepts a valid scene', () => expect(validateScene(sample())).toEqual([]));
  it('changes only addressed nodes and preserves input', () => {
    const scene = sample();
    const next = applyCommands(scene, 0, [
      { type: 'updateNode', id: 'star', patch: { color: '#00ff00' } },
    ]);
    expect(next.nodes[2].color).toBe('#00ff00');
    expect(next.nodes[1]).toEqual(scene.nodes[1]);
    expect(scene.nodes[2].color).toBe('#ffffff');
    expect(next.revision).toBe(1);
  });
  it('rejects stale revisions', () =>
    expect(() => applyCommands(sample(), 5, [])).toThrow(/revision|修订/i));
  it('rejects an entire batch when any command is invalid', () => {
    const scene = sample();
    expect(() =>
      applyCommands(scene, 0, [
        { type: 'updateNode', id: 'star', patch: { name: 'changed' } },
        { type: 'updateNode', id: 'missing', patch: { name: 'bad' } },
      ]),
    ).toThrow();
    expect(scene.nodes[2].name).toBe('Star');
  });
  it('detects parent cycles, duplicate IDs and missing resources', () => {
    const scene = sample();
    scene.nodes[0].parentId = 'star';
    scene.nodes[2].parentId = 'ground';
    expect(validateScene(scene).join()).toMatch(/cycle|循环/i);
    scene.nodes[0].parentId = undefined;
    scene.nodes[2].parentId = undefined;
    scene.nodes[2].id = 'ground';
    expect(validateScene(scene).length).toBeGreaterThan(0);
    scene.nodes[2].id = 'star';
    scene.nodes[2].assetId = 'absent';
    expect(validateScene(scene).length).toBeGreaterThan(0);
  });
  it('undoes and redoes with monotonically increasing revisions', () => {
    const h = new SceneHistory(sample());
    h.apply([{ type: 'updateNode', id: 'star', patch: { name: 'New' } }]);
    h.undo();
    expect(h.scene.nodes[2].name).toBe('Star');
    expect(h.scene.revision).toBe(2);
    h.redo();
    expect(h.scene.nodes[2].name).toBe('New');
    expect(h.scene.revision).toBe(3);
  });
  it('rejects non-finite dimensions and script-shaped patches', () => {
    const scene = sample();
    scene.nodes[0].size = [NaN, 1, 1];
    expect(validateScene(scene).length).toBeGreaterThan(0);
    expect(() =>
      applyCommands(sample(), 0, [
        { type: 'updateNode', id: 'star', patch: { script: 'alert(1)' } },
      ]),
    ).toThrow();
  });
  it('rejects deleting a prerequisite that would make story tasks unreachable', () => {
    expect(() => applyCommands(sample(), 0, [{ type: 'removeNode', id: 'guide' }])).toThrow(
      /前置|任务|reachable/i,
    );
  });
});
describe('declarative story', () => {
  it('enforces prerequisites and completes a playable story without modifying the scene', () => {
    const scene = sample();
    const initial = { flags: [], message: '', completed: false };
    const blocked = advanceStory(scene, initial, 'star');
    expect(blocked.flags).toEqual([]);
    const guide = advanceStory(scene, initial, 'guide');
    expect(guide.flags).toEqual(['met-guide']);
    const star = advanceStory(scene, guide, 'star');
    expect(star.flags).toEqual(['met-guide', 'star']);
    expect(advanceStory(scene, star, 'gate').completed).toBe(true);
    expect(scene.nodes[1].interaction.gives).toBe('met-guide');
    expect(advanceStory(scene, star, 'star').flags).toEqual(['met-guide', 'star']);
  });
});
