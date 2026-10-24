import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCadMechanism } from './check-data.mjs';
const config = JSON.parse(
  readFileSync(
    new URL('../Source/VirtualWorld/Tests/joint-dynamics-scenarios.json', import.meta.url),
  ),
).config;
const hash = 'a'.repeat(64),
  nodes = new Map([['cad', { model: hash }]]),
  models = new Map([[hash, { nodes: [{ mesh: 0 }], meshes: [{}] }]]);
const mechanism = () => ({
  kind: 'cad-joint',
  modelNodeId: 'cad',
  modelSha256: hash,
  sourceSha256: 'b'.repeat(64),
  dynamics: { ...config },
  bearings: [
    { id: 'b', pitchRadius: 0.013, ballRadius: 0.0016, innerSpeedFactor: 1, outerSpeedFactor: 0 },
  ],
  bindings: [
    {
      gltfNodeIndex: 0,
      originalPath: '/0',
      role: 'ball',
      bearingId: 'b',
      axis: [0, 0, 1],
      pivot: [0, 0, 0.02],
      center: [0.013, 0, 0.02],
    },
  ],
});
test('final mesh index and immutable model hash resolve with SI dynamics', () =>
  assert.doesNotThrow(() => checkCadMechanism(mechanism(), nodes, models)));
for (const [name, edit] of [
  ['stale hash', (m) => (m.modelSha256 = 'c'.repeat(64))],
  ['out of range node', (m) => (m.bindings[0].gltfNodeIndex = 1)],
  ['duplicate binding', (m) => m.bindings.push({ ...m.bindings[0] })],
  ['missing ball center', (m) => delete m.bindings[0].center],
  ['missing bearing', (m) => (m.bindings[0].bearingId = 'other')],
  ['unit axis', (m) => (m.bindings[0].axis = [0, 0, 10])],
  ['nonfinite inertia', (m) => (m.dynamics.inertia = NaN)],
  ['invalid transition', (m) => (m.dynamics.engageRamp = 1e-15)],
  ['unlabelled parameters', (m) => (m.dynamics.provenance = 'measured')],
])
  test(`reject ${name}`, () => {
    const m = mechanism();
    edit(m);
    assert.throws(() => checkCadMechanism(m, nodes, models));
  });
