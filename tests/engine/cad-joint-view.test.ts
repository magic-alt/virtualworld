import { expect, it } from 'vitest';
import { Group, Mesh, SphereGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { loadAnimatedGlb } from '@virtualworld/asset-runtime';
import { proceduralModel } from '../../generators/scene-builder/src/engine-export/assets';
import { createHash } from 'node:crypto';
import { CadJointView } from '../../packages/engine/src/cad-joint-view';
import { DEMO_JOINT_DYNAMICS, JointDynamics } from '@virtualworld/engine/joint-dynamics';
it('carries verified final node identities through GLB loading and actual mesh movement, restoring marker resources', async () => {
  const model = new Group();
  const ball = new Mesh(new SphereGeometry(0.002), new MeshStandardMaterial());
  ball.name = 'same';
  ball.geometry.translate(0.013, 0, 0.0221);
  model.add(ball);
  const bytes = await proceduralModel(model),
    hash = createHash('sha256').update(bytes).digest('hex');
  const loaded = await loadAnimatedGlb(
    'data:model/gltf-binary;base64,' + Buffer.from(bytes).toString('base64'),
  );
  expect(loaded.userData.glbSha256).toBe(hash);
  const mesh: Mesh[] = [];
  loaded.traverse((o) => {
    if (o instanceof Mesh) mesh.push(o);
  });
  expect(mesh[0].userData.gltfNodeIndex).toBeTypeOf('number');
  const config = {
    kind: 'cad-joint' as const,
    modelNodeId: 'model',
    sourceSha256: 'a'.repeat(64),
    modelSha256: hash,
    bindings: [
      {
        gltfNodeIndex: mesh[0].userData.gltfNodeIndex,
        originalPath: '/ball',
        role: 'ball' as const,
        center: [0.013, 0, 0.0221] as [number, number, number],
        pivot: [0, 0, 0.0221] as [number, number, number],
        axis: [0, 0, 1] as [number, number, number],
        bearingId: 'b',
      },
    ],
    bearings: [
      { id: 'b', innerSpeedFactor: 1, outerSpeedFactor: 0, pitchRadius: 0.013, ballRadius: 0.002 },
    ],
    gear: { status: 'unresolved' as const, notes: 'unknown' },
    dynamics: DEMO_JOINT_DYNAMICS,
    fixedNodeIds: [],
    fullHousingIds: [],
    sectionHousingIds: [],
    dimensions: {
      baseDiameter: 0.08,
      housingDiameter: 0.08,
      totalHeight: 0.098,
      boreDiameter: 0.01,
    },
  };
  const view = new CadJointView(loaded, config, new Group());
  const solver = new JointDynamics();
  solver.start();
  solver.tick(1);
  view.update(solver.snapshot().angle, 0, false);
  loaded.updateMatrixWorld(true);
  const position = new Vector3(0.013, 0, 0.0221).applyMatrix4(mesh[0].matrixWorld);
  expect(position.y).toBeGreaterThan(0);
  expect(position.z).toBeCloseTo(0.0221, 10);
  expect(Math.hypot(position.x, position.y)).toBeCloseTo(0.013, 10);
  view.setMarkers(true);
  const marker = mesh[0].children.find((o) => o.name === 'rolling-marker') as Mesh;
  expect(marker).toBeDefined();
  let markerGeometryDisposed = 0,
    markerMaterialDisposed = 0;
  marker.geometry.addEventListener('dispose', () => markerGeometryDisposed++);
  (marker.material as T.Material).addEventListener('dispose', () => markerMaterialDisposed++);
  view.dispose();
  expect(markerGeometryDisposed).toBe(1);
  expect(markerMaterialDisposed).toBe(1);
  expect(mesh[0].children.some((o) => o.name === 'rolling-marker')).toBe(false);
  expect(
    () => new CadJointView(loaded, { ...config, modelSha256: 'b'.repeat(64) }, new Group()),
  ).toThrow(/hash/i);
});

import * as T from 'three';
import { CadMechanismSchema, type CadMechanism } from '@virtualworld/scene-schema';
function inspectionConfig(bindings: CadMechanism['bindings'] = []): CadMechanism {
  return {
    kind: 'cad-joint',
    modelNodeId: 'model',
    sourceSha256: 'a'.repeat(64),
    modelSha256: 'b'.repeat(64),
    bindings,
    bearings: [],
    gear: { status: 'unresolved', notes: 'Unknown actual gearing' },
    dynamics: DEMO_JOINT_DYNAMICS,
    fixedNodeIds: [],
    fullHousingIds: [],
    sectionHousingIds: [],
    dimensions: {
      baseDiameter: 0.08,
      housingDiameter: 0.08,
      totalHeight: 0.098,
      boreDiameter: 0.01,
    },
  };
}
function inputBinding(index: number): CadMechanism['bindings'][number] {
  return {
    gltfNodeIndex: index,
    originalPath: `/node/${index}`,
    role: 'input',
    pivot: [0.012, -0.007, 0.025],
    axis: [0, 0, 1],
  };
}
function nestedCad() {
  const model = new T.Group(),
    parent = new T.Mesh(),
    child = new T.Mesh(),
    primitive = new T.Mesh();
  model.userData.glbSha256 = 'b'.repeat(64);
  model.position.set(0.2, 0.4, -0.1);
  model.rotation.set(-Math.PI / 2, 0.2, 0.3);
  parent.userData.gltfNodeIndex = 1;
  child.userData.gltfNodeIndex = 2;
  parent.position.set(0.006, -0.003, 0.002);
  parent.rotation.set(0.1, 0.2, 0.3);
  child.position.set(0.02, 0.01, 0.03);
  child.rotation.set(0.4, -0.2, 0.1);
  primitive.position.set(0.004, 0.002, -0.001);
  model.add(parent);
  parent.add(child, primitive);
  model.updateWorldMatrix(true, true);
  return { model, parent, child, primitive };
}
it('accepts an explicit motor window and disabled markers without inventing measured teeth', () => {
  const config = {
    ...inspectionConfig(),
    motionMarkers: false,
    defaultRpm: 1000,
    inspectionCutaway: 'quarter-window',
    gear: {
      status: 'user-specified',
      reductionRatio: 101,
      fixedMember: 'flexspline',
      fixedMemberProvenance: 'user-specified',
      evidence: 'User supplied fixed flex / circular output',
    },
  };
  expect(CadMechanismSchema.parse(config)).toMatchObject(config);
  expect(() => CadMechanismSchema.parse({ ...config, inspectionCutaway: 'unknown' })).toThrow();
});
it('does not create spherical motion markers when the CAD display disables them', () => {
  const { model, parent } = nestedCad();
  const config = inspectionConfig([
    { ...inputBinding(1), role: 'ball', center: [0.013, 0, 0], bearingId: 'b' },
  ]);
  config.bearings = [
    { id: 'b', innerSpeedFactor: 1, outerSpeedFactor: 0, pitchRadius: 0.013, ballRadius: 0.002 },
  ];
  config.motionMarkers = false;
  const view = new CadJointView(model, config, new T.Group());
  view.setMarkers(true);
  for (const section of [false, true, false]) {
    view.update(1, 0, section);
    expect(parent.children.some((o) => o.name === 'rolling-marker')).toBe(false);
  }
  view.dispose();
});
it('renders both spline roles from the selected 101 transmission and reversibly hides cut occluders in browser inspection', () => {
  const { model, parent, child } = nestedCad();
  const originals = [parent, child].map((o) =>
    model.matrixWorld.clone().invert().multiply(o.matrixWorld),
  );
  const config = inspectionConfig([
    { ...inputBinding(1), role: 'flexspline', inspectionCut: true },
    { ...inputBinding(2), role: 'circular-spline' },
  ]);
  config.gear = {
    status: 'user-specified',
    reductionRatio: 101,
    fixedMember: 'flexspline',
    evidence: 'User stated 101',
  };
  const view = new CadJointView(model, config, new T.Group());
  for (const sign of [-1, 1]) {
    view.update((sign * 101 * Math.PI) / 2, 0, true);
    model.updateWorldMatrix(true, true);
    expect(parent.visible).toBe(false);
    const parentLocal = model.matrixWorld.clone().invert().multiply(parent.matrixWorld);
    parentLocal.elements.forEach((v, i) => expect(v).toBeCloseTo(originals[0].elements[i], 10));
    const originalPoint = new T.Vector3(0.02, 0.03, 0.04).applyMatrix4(originals[1]);
    const pivot = new T.Vector3(...config.bindings[1].pivot);
    const expected = originalPoint
      .clone()
      .sub(pivot)
      .applyAxisAngle(new T.Vector3(0, 0, 1), (sign * Math.PI) / 2)
      .add(pivot);
    const actual = new T.Vector3(0.02, 0.03, 0.04).applyMatrix4(child.matrix).distanceTo(expected);
    expect(actual).toBeLessThan(1e-10);
  }
  view.update(0, 0, false);
  expect(parent.visible).toBe(true);
  expect(parent.matrix.equals(originals[0])).toBe(true);
  expect(child.matrix.equals(originals[1])).toBe(true);
  view.dispose();
});
it('preserves authored hidden CAD bodies when toggling browser inspection', () => {
  const { model, parent } = nestedCad();
  parent.visible = false;
  const view = new CadJointView(
    model,
    inspectionConfig([{ ...inputBinding(1), inspectionCut: true }]),
    new T.Group(),
  );
  view.update(0, 0, true);
  view.update(0, 0, false);
  expect(parent.visible).toBe(false);
  view.dispose();
});
it('keeps omitted bearing internals hidden and stationary in both inspection and assembly', () => {
  const { model, parent, child } = nestedCad();
  const config = inspectionConfig([
    { ...inputBinding(1), role: 'fixed', displayHidden: true, inspectionCut: true },
    { ...inputBinding(2), role: 'fixed' },
  ]);
  const view = new CadJointView(model, config, new T.Group());
  const originals = [parent, child].map((o) => o.matrix.clone());
  view.setMarkers(true);
  for (const section of [false, true, false]) {
    view.update(1.2, 0, section);
    expect(parent.visible).toBe(false);
    expect(child.visible).toBe(true);
    expect(parent.matrix.equals(originals[0])).toBe(true);
    expect(child.matrix.equals(originals[1])).toBe(true);
    expect(parent.children.some((o) => o.name === 'rolling-marker')).toBe(false);
  }
  view.dispose();
});
it('keeps omitted tagged descendants static while untagged primitives follow their mechanical body', () => {
  const { model, parent, child, primitive } = nestedCad();
  const childWorld = child.matrixWorld.clone(),
    parentWorld = parent.matrixWorld.clone();
  const primitiveLocal = primitive.matrix.clone();
  const view = new CadJointView(model, inspectionConfig([inputBinding(1)]), new T.Group());
  for (const angle of [0, Math.PI / 2, -1.2]) {
    view.update(angle, 0, false);
    model.updateWorldMatrix(true, true);
    child.matrixWorld.elements.forEach((v, i) => expect(v).toBeCloseTo(childWorld.elements[i], 10));
    expect(primitive.parent).toBe(parent);
    const expectedPrimitive = parent.matrixWorld.clone().multiply(primitiveLocal);
    primitive.matrixWorld.elements.forEach((v, i) =>
      expect(v).toBeCloseTo(expectedPrimitive.elements[i], 10),
    );
  }
  expect(parent.matrixWorld.equals(parentWorld)).toBe(false);
  view.dispose();
});
it('captures every nested configured transform before flattening and rotates each about its own fitted pivot', () => {
  const { model, parent, child } = nestedCad();
  const inverse = model.matrixWorld.clone().invert();
  const originals = [parent, child].map((o) => inverse.clone().multiply(o.matrixWorld));
  const bindings = [
    inputBinding(1),
    { ...inputBinding(2), pivot: [-0.02, 0.01, 0.03] as [number, number, number] },
  ];
  const view = new CadJointView(model, inspectionConfig(bindings), new T.Group());
  const angle = 0.7;
  view.update(angle, 0, false);
  model.updateWorldMatrix(true, true);
  [parent, child].forEach((o, i) => {
    const pivot = new T.Vector3(...bindings[i].pivot),
      q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), angle);
    const delta = new T.Matrix4().compose(
      pivot.clone().sub(pivot.clone().applyQuaternion(q)),
      q,
      new T.Vector3(1, 1, 1),
    );
    const expected = model.matrixWorld.clone().multiply(delta).multiply(originals[i]);
    o.matrixWorld.elements.forEach((v, j) => expect(v).toBeCloseTo(expected.elements[j], 10));
  });
  view.dispose();
});
it('rejects a later invalid binding without changing any original nested hierarchy or transform', () => {
  const { model, parent, child, primitive } = nestedCad();
  const objects = [model, parent, child, primitive];
  const originals = objects.map((o) => ({
    parent: o.parent,
    matrix: o.matrix.clone(),
    world: o.matrixWorld.clone(),
    auto: o.matrixAutoUpdate,
    children: [...o.children],
  }));
  expect(
    () =>
      new CadJointView(model, inspectionConfig([inputBinding(1), inputBinding(99)]), new T.Group()),
  ).toThrow(/Missing CAD node/);
  objects.forEach((o, i) => {
    expect(o.parent).toBe(originals[i].parent);
    expect(o.children).toEqual(originals[i].children);
    expect(o.matrix.equals(originals[i].matrix)).toBe(true);
    expect(o.matrixWorld.equals(originals[i].world)).toBe(true);
    expect(o.matrixAutoUpdate).toBe(originals[i].auto);
  });
});
it('closes the illustrative brake face gap through intermediate and release phases and disposes both surfaces', () => {
  const { model } = nestedCad(),
    content = new T.Group(),
    config = inspectionConfig();
  content.position.set(0.5, -0.2, 0.1);
  content.rotation.set(0.2, -0.4, 0.3);
  config.principle = {
    kind: 'illustrative-harmonic',
    flexTeeth: 60,
    ringTeeth: 62,
    radius: 0.02,
    amplitude: 0.001,
    toothHeight: 0.0002,
    clearance: 0.0001,
    position: [0.1, 0.03, -0.02],
    label: 'Illustrative demonstration assumptions; actual CAD brake and gear remain unresolved',
  };
  const view = new CadJointView(model, config, content);
  view.setPrinciple(true);
  const layer = view.principleObject!;
  view.update(0, 0, false);
  const cam = layer.getObjectByName('illustrative-wave-cam') as T.Mesh;
  expect(cam).toBeInstanceOf(T.Mesh);
  const initial = cam.geometry.getAttribute('position').array.slice();
  view.update(Math.PI / 4, 0, false);
  expect(Array.from(cam.geometry.getAttribute('position').array)).not.toEqual(Array.from(initial));
  view.update(0, 0, false);
  expect(Array.from(cam.geometry.getAttribute('position').array)).toEqual(Array.from(initial));
  const positions = cam.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    expect(Math.hypot(positions.getX(i), positions.getY(i))).toBeGreaterThanOrEqual(
      config.principle.radius * 0.24999,
    );
  const disks = layer.children.filter(
    (o): o is T.Mesh<T.CylinderGeometry, T.MeshBasicMaterial> =>
      o instanceof T.Mesh && o.geometry instanceof T.CylinderGeometry,
  );
  expect(disks).toHaveLength(2);
  const armature = disks.find((o) => o.name === 'illustrative-brake-armature')!,
    pole = disks.find((o) => o.name === 'illustrative-brake-pole')!;
  expect(armature.material).toBeInstanceOf(T.MeshBasicMaterial);
  expect(pole.material).toBeInstanceOf(T.MeshBasicMaterial);
  expect(armature.material.color.equals(pole.material.color)).toBe(false);
  content.updateWorldMatrix(true, true);
  const fixed = pole.matrixWorld.clone();
  const axis = new T.Vector3(0, 0, 1).transformDirection(layer.matrixWorld);
  const faceRange = (mesh: T.Mesh) => {
    const position = mesh.geometry.getAttribute('position'),
      values: number[] = [];
    for (let i = 0; i < position.count; i++)
      values.push(
        new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).dot(axis),
      );
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  for (const closure of [0, 0.3, 1, 0.6, 0]) {
    view.update(0.8, closure, false);
    content.updateWorldMatrix(true, true);
    const gap = faceRange(pole).min - faceRange(armature).max;
    expect(gap).toBeCloseTo(config.dynamics.armatureTravel * (1 - closure), 10);
    expect(pole.matrixWorld.equals(fixed)).toBe(true);
  }
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  layer.traverse((o) => {
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  let disposedGeometry = 0,
    disposedMaterial = 0;
  for (const g of geometries) g.addEventListener('dispose', () => disposedGeometry++);
  for (const m of materials) m.addEventListener('dispose', () => disposedMaterial++);
  view.setPrinciple(false);
  expect(layer.visible).toBe(false);
  view.dispose();
  expect(layer.parent).toBeNull();
  expect(disposedGeometry).toBe(geometries.size);
  expect(disposedMaterial).toBe(materials.size);
});

it('validates the complete directed coaxial drive chain before changing runtime CAD', () => {
  const roles = ['input', 'input', 'input', 'flexspline', 'circular-spline', 'output'] as const;
  const bindings = roles.map((role, i) => ({
    ...inputBinding(i + 1),
    role,
    pivot: [0, 0, i * 0.01] as [number, number, number],
  }));
  const config = {
    ...inspectionConfig(bindings),
    gear: {
      status: 'user-specified' as const,
      reductionRatio: 101,
      fixedMember: 'flexspline' as const,
      evidence: 'User specifies topology',
    },
    driveChain: {
      rotor: 1,
      shaft: 2,
      waveGenerator: 3,
      flexspline: 4,
      circularSpline: 5,
      output: 6,
    },
  };
  expect(CadMechanismSchema.safeParse(config).success).toBe(true);
  for (const patch of [{ shaft: 1 }, { waveGenerator: 99 }])
    expect(
      CadMechanismSchema.safeParse({ ...config, driveChain: { ...config.driveChain, ...patch } })
        .success,
    ).toBe(false);
  for (const patch of [
    { role: 'fixed' as const },
    { axis: [0, 0, -1] },
    { pivot: [0.001, 0, 0] },
  ]) {
    const invalid = {
      ...config,
      bindings: bindings.map((b, i) => (i === 2 ? { ...b, ...patch } : b)),
    };
    expect(CadMechanismSchema.safeParse(invalid).success).toBe(false);
  }
  const { model } = nestedCad(),
    before = model.children.slice();
  expect(
    () =>
      new CadJointView(
        model,
        { ...config, modelSha256: 'b'.repeat(64), driveChain: { ...config.driveChain, shaft: 1 } },
        new T.Group(),
      ),
  ).toThrow(/chain/i);
  expect(model.children).toEqual(before);
});

it('omits the illustrative cam when legacy principle dimensions leave no room for a bore', () => {
  const { model } = nestedCad(),
    config = inspectionConfig();
  config.principle = {
    kind: 'illustrative-harmonic',
    flexTeeth: 60,
    ringTeeth: 62,
    radius: 0.0001,
    amplitude: 0.00001,
    toothHeight: 0.000001,
    clearance: 0.000001,
    position: [0.1, 0, 0],
    label: 'Legacy small principle',
  };
  const view = new CadJointView(model, config, new T.Group());
  view.setPrinciple(true);
  view.update(0.5, 0, false);
  expect(view.principleObject!.getObjectByName('illustrative-wave-cam')).toBeUndefined();
  view.dispose();
});

it('validates reversible inspection opacity without permitting ambiguous cut materials', () => {
  const binding = { ...inputBinding(1), inspectionOpacity: 0.18 };
  expect(CadMechanismSchema.safeParse(inspectionConfig([binding])).success).toBe(true);
  for (const opacity of [0, 1, -0.1, Infinity, NaN])
    expect(
      CadMechanismSchema.safeParse(inspectionConfig([{ ...binding, inspectionOpacity: opacity }]))
        .success,
    ).toBe(false);
  expect(
    CadMechanismSchema.safeParse(inspectionConfig([{ ...binding, inspectionCut: true }])).success,
  ).toBe(false);
});
it('ghosts only selected occluder materials, retains complete geometry and restores multi-material sources', () => {
  const { model, parent, child, primitive } = nestedCad(),
    geometry = parent.geometry;
  const original = [
    new T.MeshStandardMaterial({ color: '#667788', metalness: 0.8 }),
    new T.MeshStandardMaterial({ color: '#c6c7c8' }),
  ];
  original[0].alphaTest = 0.5;
  original[1].alphaHash = true;
  parent.material = original;
  parent.castShadow = true;
  primitive.material = original[0];
  child.material = original[1];
  const binding = { ...inputBinding(1), inspectionOpacity: 0.18 };
  const view = new CadJointView(model, inspectionConfig([binding]), new T.Group());
  view.update(0.7, 0, true);
  const copies = parent.material as T.Material[],
    childMaterial = child.material;
  expect(parent.castShadow).toBe(false);
  expect(copies).not.toBe(original);
  expect(copies).toHaveLength(2);
  for (const m of copies) {
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0.18);
    expect(m.depthWrite).toBe(false);
    expect(m.alphaTest).toBe(0);
    expect(m.alphaHash).toBe(false);
  }
  expect(primitive.material).not.toBe(original[0]);
  expect(childMaterial).toBe(original[1]);
  expect(parent.geometry).toBe(geometry);
  expect(original.every((m) => m.opacity === 1 && !m.transparent)).toBe(true);
  view.update(1, 0, true);
  expect(parent.material).toBe(copies);
  view.update(1, 0, false);
  expect(parent.material).toBe(original);
  expect(parent.castShadow).toBe(true);
  expect(primitive.material).toBe(original[0]);
  view.update(2, 0, true);
  expect(parent.material).toBe(copies);
  let sourceDisposed = 0,
    copyDisposed = 0;
  original.forEach((m) => m.addEventListener('dispose', () => sourceDisposed++));
  copies.forEach((m) => m.addEventListener('dispose', () => copyDisposed++));
  view.dispose();
  expect(parent.material).toBe(original);
  expect(child.material).toBe(original[1]);
  expect(copyDisposed).toBe(2);
  expect(sourceDisposed).toBe(0);
  expect(original[0].alphaTest).toBe(0.5);
  expect(original[1].alphaHash).toBe(true);
});
