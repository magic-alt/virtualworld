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
    navigation: { kind: 'plane', bounds: { min: [-10, -10], max: [10, 10] } },
  };
}

describe('bounded planar navigation', () => {
  it('accepts a visible actor preview and an area with capsule clearance', () => {
    expect(assertScene(scene()).actor).toMatchObject({ nodeId: 'preview' });
    expect(assertScene(scene()).navigation).toMatchObject({
      bounds: { min: [-10, -10], max: [10, 10] },
    });
  });

  it('keeps legacy unbounded scenes valid', () => {
    expect(
      assertScene({ ...emptyScene('world'), navigation: { kind: 'plane' } }).navigation,
    ).toEqual({ kind: 'plane' });
  });

  it.each([
    { min: [1, -10], max: [-1, 10] },
    { min: [-10, 0], max: [10, 0] },
    { min: [-0.2, -10], max: [0.2, 10] },
    { min: [-10, -10], max: [Infinity, 10] },
  ])('rejects invalid or impassable bounds %j', (bounds) => {
    const value = scene();
    value.navigation.bounds = bounds;
    expect(() => assertScene(value)).toThrow();
  });

  it.each([
    [10, 0, 0],
    [9.8, 0, 0],
    [0, 0, -10],
    [0, 0, -9.8],
  ])('rejects unsafe spawn %j', (...spawn) => {
    expect(() => assertScene({ ...scene(), spawn })).toThrow(/出生点/);
  });

  it('accounts for the procedural capsule when no actor is configured', () => {
    const { actor: _actor, ...value } = scene();
    expect(() => assertScene({ ...value, spawn: [9.72, 0, 0] })).toThrow(/出生点/);
    expect(assertScene({ ...value, spawn: [9.7, 0, 0] }).spawn).toEqual([9.7, 0, 0]);
  });
});
