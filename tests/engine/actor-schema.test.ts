import { describe, expect, it } from 'vitest';
import { assertScene, emptyScene, node } from '@virtualworld/scene-schema';

function scene() {
  return {
    ...emptyScene('world'),
    spawn: [0, 0, 0],
    assets: [
      { id: 'traveler', name: 'Traveler', type: 'glb', url: 'assets/traveler.glb', bytes: 1 },
    ],
    nodes: [
      node('preview', 'Traveler', 'glb', [0, 0, 0], [1, 1, 1], '#ffffff', { assetId: 'traveler' }),
    ],
    actor: {
      assetId: 'traveler',
      nodeId: 'preview',
      height: 1.6,
      clips: { idle: 'Idle', walk: 'Walk', interact: 'Interact' },
    },
    navigation: { kind: 'plane' },
  };
}

describe('authored actor preview bindings', () => {
  it('accepts a visible independent preview for the configured actor', () => {
    expect(assertScene(scene()).actor).toMatchObject({ nodeId: 'preview' });
  });

  it('preserves actors without an authored preview binding', () => {
    const value = scene();
    const { nodeId: _nodeId, ...actor } = value.actor;
    expect(assertScene({ ...value, actor }).actor).toEqual(actor);
  });

  it.each([
    { visible: false },
    { assetId: 'other' },
    { assetNode: '0' },
    { parentId: 'parent' },
    { collider: { shape: 'box', size: [1, 2, 1] } },
    { interaction: { title: 'Talk', text: 'Stay here' } },
  ])('rejects an ambiguous preview binding %j', (patch) => {
    const value = scene();
    value.assets.push({ ...value.assets[0], id: 'other' });
    value.nodes.push(node('parent', 'Parent', 'box', [0, 0, 0], [1, 1, 1], '#ffffff'));
    Object.assign(value.nodes[0], patch);
    expect(() => assertScene(value)).toThrow(/角色预览/);
  });

  it('rejects missing previews and descendants that would disappear during play', () => {
    const value = scene();
    value.actor.nodeId = 'missing';
    expect(() => assertScene(value)).toThrow(/角色预览/);
    value.actor.nodeId = 'preview';
    value.nodes.push(
      node('child', 'Child', 'box', [0, 0, 0], [1, 1, 1], '#ffffff', { parentId: 'preview' }),
    );
    expect(() => assertScene(value)).toThrow(/角色预览/);
  });
});
