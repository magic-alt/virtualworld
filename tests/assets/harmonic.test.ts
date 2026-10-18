import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const root = new URL('../../', import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
it('retains verified SI dimensions, explicit engineering limits and 200/202 tooth kinematics', () => {
  const r = json('assets/manifests/showcase/harmonic-joint.json');
  expect(r.dimensions).toEqual({
    baseDiameter: 0.215,
    housingDiameter: 0.18,
    totalHeight: 0.165,
    boreDiameter: 0.02,
  });
  expect(r.airGap).toBeCloseTo(0.0005, 8);
  expect(r.ratio).toBe(-100);
  expect(r.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
  expect(r.validationScope).toContain('not load');
});
it('serializes actual independent meshes, hollow bore and both morph targets', () => {
  const b = readFileSync(new URL('assets/optimized/showcase/harmonic-joint.glb', root));
  const d = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const flex = d.meshes.find((m: { name: string }) => m.name === 'flex-cup');
  expect(flex.extras.targetNames).toEqual(['WaveCos', 'WaveSin']);
  expect(flex.primitives[0].targets).toHaveLength(2);
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  expect(report.parts.length).toBeGreaterThan(35);
  expect(report.minimumBoreRadius).toBeGreaterThanOrEqual(0.01 - 1e-7);
  expect(d.buffers.every((v: { uri?: string }) => !v.uri)).toBe(true);
});
it('exposes split world with unconfirmed independent motion groups and measured asset paths', () => {
  const s = json('worlds/demo-harmonic-joint/scene.json');
  expect(s.mechanism.flexTeeth).toBe(200);
  expect(s.mechanism.ringTeeth).toBe(202);
  const wave = s.nodes.find((n: { id: string }) => n.id === s.mechanism.waveNodeId);
  expect(wave.kind).toBe('group');
  expect(wave.joint.confirmed).toBe(false);
  expect(s.nodes.find((n: { id: string }) => n.id === s.mechanism.outputNodeId).parentId).toBe(
    'joint-root',
  );
});
function assetData() {
  const b = readFileSync(new URL('assets/optimized/showcase/harmonic-joint.glb', root));
  const d = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const binaryStart = 28 + b.readUInt32LE(12);
  const accessor = (index: number): number[][] => {
    const a = d.accessors[index],
      n = a.type === 'VEC3' ? 3 : 1;
    const width = (type: number) => (type === 5126 || type === 5125 ? 4 : type === 5123 ? 2 : 1);
    const read = (at: number, type: number) =>
      type === 5126
        ? b.readFloatLE(at)
        : type === 5125
          ? b.readUInt32LE(at)
          : type === 5123
            ? b.readUInt16LE(at)
            : b.readUInt8(at);
    const result = Array.from({ length: a.count }, () => Array(n).fill(0));
    if (a.bufferView !== undefined) {
      const v = d.bufferViews[a.bufferView],
        w = width(a.componentType);
      for (let i = 0; i < a.count; i++)
        for (let j = 0; j < n; j++)
          result[i][j] = read(
            binaryStart +
              (v.byteOffset || 0) +
              (a.byteOffset || 0) +
              i * (v.byteStride || n * w) +
              j * w,
            a.componentType,
          );
    }
    if (a.sparse) {
      const s = a.sparse,
        iv = d.bufferViews[s.indices.bufferView],
        vv = d.bufferViews[s.values.bufferView];
      for (let i = 0; i < s.count; i++) {
        const at = read(
          binaryStart +
            (iv.byteOffset || 0) +
            (s.indices.byteOffset || 0) +
            i * width(s.indices.componentType),
          s.indices.componentType,
        );
        for (let j = 0; j < n; j++)
          result[at][j] = read(
            binaryStart +
              (vv.byteOffset || 0) +
              (s.values.byteOffset || 0) +
              (i * n + j) * width(a.componentType),
            a.componentType,
          );
      }
    }
    return result;
  };
  return {
    d,
    accessor,
    primitive: (name: string) =>
      d.meshes.find((m: { name: string }) => m.name === name).primitives[0],
  };
}
it('measures serialized Y-up positions, exact tooth counts and 0.5mm radial morph amplitude', () => {
  const { d, accessor, primitive } = assetData();
  const base = accessor(primitive('base-flange').attributes.POSITION);
  expect(Math.max(...base.map((p) => p[0])) - Math.min(...base.map((p) => p[0]))).toBeCloseTo(
    0.215,
    6,
  );
  expect(
    Math.max(...accessor(primitive('output-flange').attributes.POSITION).map((p) => p[1])),
  ).toBeCloseTo(0.165, 6);
  for (const [name, threshold, count, inside] of [
    ['flex-cup', 0.05244, 200, false],
    ['fixed-circular-spline-202', 0.05236, 202, true],
  ] as const) {
    const pts = accessor(primitive(name).attributes.POSITION);
    const peaks = new Set(
      pts
        .filter((p) =>
          inside ? Math.hypot(p[0], p[2]) < threshold : Math.hypot(p[0], p[2]) > threshold,
        )
        .map((p) => Math.atan2(p[2], p[0]).toFixed(5)),
    );
    expect(peaks.size).toBe(count);
  }
  const flex = primitive('flex-cup');
  for (const target of flex.targets) {
    const delta = accessor(target.POSITION);
    expect(Math.max(...delta.map((p) => Math.hypot(p[0], p[2])))).toBeCloseTo(0.0005, 7);
    expect(delta.every((p) => Math.abs(p[1]) < 1e-8)).toBe(true);
  }
  expect(d.meshes.find((m: { name: string }) => m.name === 'flex-cup').weights).toEqual([0, 0]);
});
it('retains named contact exceptions and zero unexpected nominal surface intersections for full and section variants', () => {
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  expect(report.interference.configurations.map((c: { section: boolean }) => c.section)).toEqual([
    false,
    true,
  ]);
  expect(report.interference.unexpected).toEqual([]);
  expect(report.gltfValidation.issues.numErrors).toBe(0);
  expect(report.finalNodePathsVerified).toBe(true);
});
it('contains eight real through holes rather than painted or capped circles', () => {
  const { accessor, primitive } = assetData(),
    p = primitive('base-flange');
  const vertices = accessor(p.attributes.POSITION),
    indices = accessor(p.indices).flat();
  const pointInTriangle = (x: number, z: number, a: number[], b: number[], c: number[]) => {
    const cross = (u: number[], v: number[]) =>
      (v[0] - u[0]) * (z - u[2]) - (v[2] - u[2]) * (x - u[0]);
    const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-10) return false;
    const signs = [cross(a, b), cross(b, c), cross(c, a)];
    return signs.every((t) => t / area >= -1e-7 && t / area <= 1 + 1e-7);
  };
  const hits = (x: number, z: number) => {
    for (let i = 0; i < indices.length; i += 3)
      if (
        pointInTriangle(
          x,
          z,
          vertices[indices[i]],
          vertices[indices[i + 1]],
          vertices[indices[i + 2]],
        )
      )
        return true;
    return false;
  };
  for (const hole of json('assets/manifests/showcase/harmonic-joint.json').mountingHoles)
    expect(hits(hole.center[0], hole.center[2])).toBe(false);
  expect(hits(0.08, 0)).toBe(true);
  expect(hits(0, 0)).toBe(false);
});
import { assembleWorld } from '@virtualworld/scene-builder';
it('assembles through the public validated world pipeline', () => {
  const scene = assembleWorld(
    json('worlds/demo-harmonic-joint/scene.json'),
    json('worlds/demo-harmonic-joint/story.json'),
    json('worlds/demo-harmonic-joint/assets.json'),
  );
  expect(scene.nodes.filter((n) => n.joint).every((n) => n.joint?.confirmed === false)).toBe(true);
  expect(scene.assets[0].bytes).toBe(
    readFileSync(new URL('assets/optimized/showcase/harmonic-joint.glb', root)).length,
  );
});
