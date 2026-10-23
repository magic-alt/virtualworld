import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { harmonicState } from '../../packages/engine/src/mechanism';
const root = new URL('../../', import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
it('retains verified SI dimensions, explicit engineering limits and 200/202 tooth kinematics', () => {
  const r = json('assets/manifests/showcase/harmonic-joint.json');
  expect(r.dimensions).toEqual({
    baseDiameter: 0.1,
    housingDiameter: 0.1,
    totalHeight: 0.088111111,
    boreDiameter: 0.018,
  });
  expect(r.airGap).toBeCloseTo(0.0004, 8);
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
  expect(report.minimumBoreRadius).toBeGreaterThanOrEqual(0.009 - 1e-7);
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
it('ends both motor shell variants before the exposed reducer instead of enclosing the output assembly', () => {
  const { accessor, primitive } = assetData();
  for (const name of ['housing-full', 'housing-section']) {
    const points = accessor(primitive(name).attributes.POSITION);
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(0.07632, 6);
  }
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  for (const name of ['reducer-mount-pillars-4', 'output-bearing-bridges-4'])
    expect(
      report.parts.some(
        (p: { name: string; assembly: string }) => p.name === name && p.assembly === 'fixed',
      ),
    ).toBe(true);
});
it('cuts twelve real mounting holes on separate rotating and fixed output bolt circles', () => {
  const { accessor, primitive } = assetData();
  for (const name of ['output-flange', 'output-fixed-mount-ring']) {
    const part = primitive(name),
      positions = accessor(part.attributes.POSITION),
      indices = accessor(part.indices).flat();
    const hits = (x: number, z: number) => {
      for (let j = 0; j < indices.length; j += 3) {
        const [a, b, c] = indices.slice(j, j + 3).map((i) => positions[i]);
        const cross = (u: number[], v: number[]) =>
          (v[0] - u[0]) * (z - u[2]) - (v[2] - u[2]) * (x - u[0]);
        const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
        if (Math.abs(area) < 1e-14) continue;
        if ([cross(a, b), cross(b, c), cross(c, a)].every((s) => s / area >= -1e-8)) return true;
      }
      return false;
    };
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6 + 0.07;
      const radius = name === 'output-flange' ? (0.062 * 10) / 18 : (0.084 * 10) / 18;
      expect(
        name === 'output-flange'
          ? hits(radius * Math.sin(angle), -radius * Math.cos(angle))
          : hits(radius * Math.cos(angle), -radius * Math.sin(angle)),
        `${name} inspection opening ${i}`,
      ).toBe(false);
    }
    expect(
      hits(name === 'output-flange' ? 0.037 : 0.043, 0),
      `${name} retains the outer load path`,
    ).toBe(true);
  }
});
it('measures compact Y-up positions, exact tooth counts and 0.3mm radial morph amplitude', () => {
  const { d, accessor, primitive } = assetData();
  const base = accessor(primitive('base-flange').attributes.POSITION);
  expect(Math.max(...base.map((p) => p[0])) - Math.min(...base.map((p) => p[0]))).toBeCloseTo(
    0.1,
    6,
  );
  expect(
    Math.max(...accessor(primitive('base-flange').attributes.POSITION).map((p) => p[1])),
  ).toBeCloseTo(0.0792, 6);
  for (const [name, threshold, count, inside] of [
    ['flex-cup', 0.02694, 200, false],
    ['fixed-circular-spline-202', 0.02696, 202, true],
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
    expect(Math.max(...delta.map((p) => Math.hypot(p[0], p[2])))).toBeCloseTo(0.0003, 7);
    expect(delta.every((p) => Math.abs(p[1]) < 1e-8)).toBe(true);
  }
  expect(d.meshes.find((m: { name: string }) => m.name === 'flex-cup').weights).toEqual([0, 0]);
});
it('retains named contact exceptions and zero unexpected nominal surface intersections for full and section variants', () => {
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  expect(report.interference.configurations.some((c: { section: boolean }) => c.section)).toBe(
    true,
  );
  expect(report.interference.configurations.length).toBeGreaterThanOrEqual(6);
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
  expect(hits(0.048, 0)).toBe(true);
  expect(hits(0, 0)).toBe(false);
});
it('contains drive electronics, independently mounted dual encoders and an optional permanent magnet brake', () => {
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  const names = report.parts.map((p: { name: string }) => p.name);
  for (const name of [
    'drive-board',
    'drive-power-stage',
    'drive-bus-capacitors',
    'drive-control-chip',
    'encoder-board',
    'encoder-code-ring',
    'output-encoder-board',
    'output-encoder-code-ring',
    'brake-yoke',
    'brake-permanent-magnet',
    'brake-release-coil',
    'brake-armature',
  ])
    expect(names).toContain(name);
  const scene = json('worlds/demo-harmonic-joint/scene.json');
  expect(scene.mechanism.subsystems.find((s: { id: string }) => s.id === 'brake').optional).toBe(
    'brake',
  );
  expect(report.references.length).toBeGreaterThanOrEqual(3);
  expect(report.reconstruction).toContain('original');
});
it('keeps sampled full-depth bore rays clear through every serialized mesh, including internal plates', () => {
  const { d, accessor } = assetData();
  const rays = [
    [0, 0],
    ...Array.from({ length: 16 }, (_, i) => [
      0.0088 * Math.cos((i * Math.PI) / 8),
      0.0088 * Math.sin((i * Math.PI) / 8),
    ]),
  ];
  for (const mesh of d.meshes) {
    const p = mesh.primitives[0],
      vertices = accessor(p.attributes.POSITION),
      indices = accessor(p.indices).flat();
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3).map((index) => vertices[index]);
      const cross = (u: number[], v: number[], x: number, z: number) =>
        (v[0] - u[0]) * (z - u[2]) - (v[2] - u[2]) * (x - u[0]);
      const area = cross(a, b, c[0], c[2]);
      if (Math.abs(area) < 1e-14) continue;
      for (const [x, z] of rays) {
        const inside = [cross(a, b, x, z), cross(b, c, x, z), cross(c, a, x, z)].every(
          (s) => s / area >= -1e-9,
        );
        if (inside) throw new Error(`${mesh.name} occludes bore at ${x},${z}`);
      }
    }
  }
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

it('orders actual serialized geometry from bottom reducer to motor, optional brake and top driver', () => {
  const { accessor, primitive } = assetData();
  const range = (name: string) => {
    const ys = accessor(primitive(name).attributes.POSITION).map((p) => p[1]);
    return [Math.min(...ys), Math.max(...ys)];
  };
  const output = range('output-flange'),
    reducer = range('fixed-circular-spline-202'),
    motor = range('stator-back-iron'),
    brake = range('brake-yoke'),
    board = range('drive-board'),
    components = range('drive-bus-capacitors');
  expect(output[0]).toBeCloseTo(0, 6);
  expect(output[1]).toBeLessThan(reducer[0]);
  expect(reducer[1]).toBeLessThan(motor[0]);
  expect(motor[1]).toBeLessThan(brake[0]);
  expect(brake[1]).toBeLessThan(board[0]);
  expect(components[0]).toBeGreaterThanOrEqual(board[1] - 1e-7);
  const scene = json('worlds/demo-harmonic-joint/scene.json');
  const offset = (name: string) =>
    scene.nodes.find((n: { id: string }) => n.id === 'harmonic-' + name).explode[1];
  expect(offset('drive-board')).toBeGreaterThan(offset('brake-yoke'));
  expect(offset('output-flange')).toBeLessThan(offset('fixed-circular-spline-202'));
});
it('keeps the flex major axis aligned with the input cam after reversing the axial assembly frame', () => {
  const { accessor, primitive } = assetData(),
    flex = primitive('flex-cup');
  const positions = accessor(flex.attributes.POSITION),
    cos = accessor(flex.targets[0].POSITION),
    sin = accessor(flex.targets[1].POSITION);
  const lip = positions
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Math.abs(p[1] - 0.02952) < 1e-7);
  for (const input of [0, 0.173, -0.793, 1.271, 5.812]) {
    const state = harmonicState(input, 6, 200, 202);
    let best = { delta: -Infinity, angle: 0 };
    for (const { p, i } of lip) {
      const c = cos[i],
        s = sin[i],
        r = Math.hypot(p[0], p[2]);
      const delta =
        ((c[0] * state.cos + s[0] * state.sin) * p[0] +
          (c[2] * state.cos + s[2] * state.sin) * p[2]) /
        r;
      if (delta > best.delta) best = { delta, angle: Math.atan2(-p[2], p[0]) + state.outputAngle };
    }
    expect(best.delta).toBeCloseTo(0.0003, 7);
    // Opposed ellipse peaks share an axis. Grid discretization is at most pi/800.
    expect(Math.abs(Math.sin(best.angle - Math.PI / 2 - input))).toBeLessThan(0.0041);
  }
});
it('cuts matching support bays in section mode so pillars do not end in removed race quadrants', () => {
  const { accessor, primitive } = assetData();
  for (const name of ['reducer-mount-pillars-4', 'output-bearing-bridges-4']) {
    const full = accessor(primitive(name).attributes.POSITION),
      cut = accessor(primitive(name + '-section').attributes.POSITION);
    expect(full.some((p) => p[0] > 0 && p[2] < 0)).toBe(true);
    expect(cut.some((p) => p[0] > 0 && p[2] < 0)).toBe(false);
  }
});

it('reconstructs a compact product envelope with rear interface cover and separate output mounting face', () => {
  const { accessor, primitive } = assetData();
  const range = (name: string) => {
    const p = accessor(primitive(name).attributes.POSITION);
    return {
      radius: Math.max(...p.map((v) => Math.hypot(v[0], v[2]))),
      min: Math.min(...p.map((v) => v[1])),
      max: Math.max(...p.map((v) => v[1])),
    };
  };
  const shell = range('housing-full'),
    rear = range('rear-interface-cover'),
    output = range('output-flange');
  expect(shell.radius).toBeCloseTo(0.05, 6);
  expect(range('base-flange').radius).toBeLessThanOrEqual(0.050001);
  expect(rear.max).toBeCloseTo(0.084333333, 6);
  expect(output.radius).toBeCloseTo(0.038888889, 6);
  expect(output.min).toBeCloseTo(0, 6);
  expect(range('drive-bus-capacitors').max).toBeLessThan(rear.min);
  for (const name of [
    'rear-power-socket',
    'rear-can-sockets',
    'rear-ethercat-sockets',
    'rear-io-socket',
    'rear-battery-socket',
    'rear-interface-legends',
    'output-fixed-mount-ring',
  ])
    expect(primitive(name)).toBeTruthy();
  const report = json('assets/manifests/showcase/harmonic-joint.json');
  expect(report.exteriorReference.bodyLength).toBeCloseTo(0.084333333, 6);
  expect(report.exteriorReference.sourceBodyLength).toBe(0.0759);
});

it('retains a dielectric floor under both power contact cavities instead of floating sleeves', () => {
  const { accessor, primitive } = assetData(),
    part = primitive('rear-power-socket');
  const p = accessor(part.attributes.POSITION),
    indices = accessor(part.indices).flat();
  for (const y of [0.028 - 0.0031, 0.028 + 0.0031]) {
    const x = -0.012,
      z = -y;
    const floors = [];
    for (let j = 0; j < indices.length; j += 3) {
      const [a, b, c] = indices.slice(j, j + 3).map((i) => p[i]);
      const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-14) continue;
      const cross = (u: number[], v: number[]) =>
        (v[0] - u[0]) * (z - u[2]) - (v[2] - u[2]) * (x - u[0]);
      if ([cross(a, b), cross(b, c), cross(c, a)].every((s) => s / area >= -1e-7))
        floors.push((a[1] + b[1] + c[1]) / 3);
    }
    expect(floors.some((v) => v > 0.0835 && v < 0.0845)).toBe(true);
  }
});

it('keeps machined output flange planes flat-shaded instead of bending normals into the bolt bores', () => {
  const { accessor, primitive } = assetData();
  const p = primitive('output-flange');
  const positions = accessor(p.attributes.POSITION),
    normals = accessor(p.attributes.NORMAL);
  const indices = accessor(p.indices).map((v) => v[0]);
  let planes = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3),
      [a, b, c] = ids.map((id) => positions[id]);
    if (Math.max(a[1], b[1], c[1]) - Math.min(a[1], b[1], c[1]) > 1e-8) continue;
    const crossY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (Math.abs(crossY) < 1e-10) continue;
    planes++;
    for (const id of ids)
      expect(normals[id][1] * Math.sign(crossY), `flange plane vertex ${id}`).toBeGreaterThan(
        0.999,
      );
  }
  expect(planes).toBeGreaterThan(100);
});

it('aligns the serialized flex mouth ellipse with the actual cam through forward and reverse turns', () => {
  const { d, accessor, primitive } = assetData();
  const flex = primitive('flex-cup');
  const basis = accessor(flex.attributes.POSITION);
  const names: string[] = d.meshes.find((m: { name: string }) => m.name === 'flex-cup').extras
    .targetNames;
  const cos = accessor(flex.targets[names.indexOf('WaveCos')].POSITION);
  const sin = accessor(flex.targets[names.indexOf('WaveSin')].POSITION);
  const mouth = Math.max(...basis.map((p) => p[1]));
  const indices = [
    ...new Map(
      basis.flatMap((p, i) =>
        Math.abs(p[1] - mouth) < 1e-7 && Math.hypot(p[0], p[2]) > 0.0264
          ? [[p.join(','), i] as const]
          : [],
      ),
    ).values(),
  ];
  const cam = [
    ...new Map(
      accessor(primitive('elliptical-wave-cam').attributes.POSITION)
        .filter((p) => Math.hypot(p[0], p[2]) > 0.02)
        .map((p) => [p.join(','), p]),
    ).values(),
  ];
  expect(indices.length).toBeGreaterThanOrEqual(200);
  expect(cam.length).toBeGreaterThanOrEqual(100);
  const rotate = (p: number[], a: number) => [
    Math.cos(a) * p[0] + Math.sin(a) * p[2],
    p[1],
    -Math.sin(a) * p[0] + Math.cos(a) * p[2],
  ];
  const axis = (points: number[][]) => {
    const x = points.reduce((s, p) => s + p[0], 0) / points.length;
    const z = points.reduce((s, p) => s + p[2], 0) / points.length;
    let xx = 0,
      zz = 0,
      xz = 0;
    for (const p of points) {
      xx += (p[0] - x) ** 2;
      zz += (p[2] - z) ** 2;
      xz += (p[0] - x) * (p[2] - z);
    }
    expect(Math.hypot(xx - zz, 2 * xz)).toBeGreaterThan(1e-10);
    return Math.atan2(2 * xz, xx - zz) / 2;
  };
  const difference = (a: number, b: number) =>
    Math.atan2(Math.sin(2 * (a - b)), Math.cos(2 * (a - b))) / 2;
  for (const input of [0, 0.5, 1.5, 3.2, 2 * Math.PI, -0.5, -3.2]) {
    const state = harmonicState(input, 6, 200, 202);
    const deformed = indices.map((i) =>
      rotate(
        basis[i].map((v, j) => v + state.cos * cos[i][j] + state.sin * sin[i][j]),
        state.outputAngle,
      ),
    );
    const camAxis = axis(cam.map((p) => rotate(p, input)));
    expect(Math.abs(difference(camAxis, axis(cam) - input))).toBeLessThan(1e-5);
    expect(Math.abs(difference(axis(deformed), camAxis)), `input ${input}`).toBeLessThan(1e-5);
  }
});
