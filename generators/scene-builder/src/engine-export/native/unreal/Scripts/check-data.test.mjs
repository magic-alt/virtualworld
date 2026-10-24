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

test('stated 101 topology and reversible inspection flags resolve final nodes', () => {
  for (const role of ['flexspline', 'circular-spline']) {
    const m = mechanism();
    m.gear = {
      status: 'user-specified',
      reductionRatio: 101,
      fixedMember: role,
      evidence: 'User stated 101; topology remains geometric inference',
    };
    m.bindings[0] = { ...m.bindings[0], role, inspectionCut: true, inspectionHidden: false };
    assert.doesNotThrow(() => checkCadMechanism(m, nodes, models));
  }
});
for (const [name, edit] of [
  ['zero reduction', (m) => (m.gear.reductionRatio = 0)],
  ['nonfinite reduction', (m) => (m.gear.reductionRatio = Infinity)],
  ['unidentified fixed member', (m) => (m.gear.fixedMember = 'housing')],
  ['unlabelled ratio', (m) => (m.gear.evidence = '')],
  ['invalid inspection cut', (m) => (m.bindings[0].inspectionCut = 'yes')],
])
  test(`reject ${name}`, () => {
    const m = mechanism();
    m.gear = {
      status: 'user-specified',
      reductionRatio: 101,
      fixedMember: 'flexspline',
      evidence: 'User stated 101',
    };
    edit(m);
    assert.throws(() => checkCadMechanism(m, nodes, models));
  });
