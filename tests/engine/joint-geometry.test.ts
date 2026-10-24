import { expect, it } from 'vitest';
import { Vector3, Quaternion } from 'three';
import {
  cadBindingPose,
  principlePoint,
  principleRingRadius,
} from '@virtualworld/engine/joint-geometry';
const p = {
  kind: 'illustrative-harmonic' as const,
  flexTeeth: 60,
  ringTeeth: 62,
  radius: 0.025,
  amplitude: 0.001,
  toothHeight: 0.0002,
  clearance: 0.00005,
  position: [0.12, 0.025, 0] as [number, number, number],
  label: 'Principle only',
};
it('transports actual balls about the fitted race centre with independent world self-spin', () => {
  const b = {
    gltfNodeIndex: 20,
    originalPath: '/20:ball',
    role: 'ball' as const,
    pivot: [0.002, 0, 0.0221] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
    center: [0.015, 0, 0.0221] as [number, number, number],
    bearingId: 'b',
  };
  const bearing = {
    id: 'b',
    innerSpeedFactor: 1,
    outerSpeedFactor: 0,
    pitchRadius: 0.013,
    ballRadius: 0.00166564938,
  };
  const pose = cadBindingPose(b, bearing, Math.PI / 2, 0, 0.00015, undefined);
  const q = new Quaternion(...pose.rotation),
    center = new Vector3(...b.center).applyQuaternion(q).add(new Vector3(...pose.translation));
  expect(center.distanceTo(new Vector3(...b.pivot))).toBeCloseTo(0.013, 12);
  expect(center.z).toBeCloseTo(0.0221, 12);
  expect(center.y).toBeGreaterThan(0);
  const expectedCage = ((1 - bearing.ballRadius / bearing.pitchRadius) * Math.PI) / 4;
  expect(center.x).toBeCloseTo(0.002 + 0.013 * Math.cos(expectedCage), 12);
  expect(center.y).toBeCloseTo(0.013 * Math.sin(expectedCage), 12);
  expect(
    q.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), expectedCage)),
  ).toBeGreaterThan(0.1);
  for (const role of ['unknown', 'fixed', 'output'] as const)
    expect(cadBindingPose({ ...b, role }, undefined, 3, 1, 0.00015, undefined)).toEqual({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    });
  expect(cadBindingPose(b, bearing, 0, 0, 0.00015, undefined)).toEqual({
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
  });
});
it('preserves a non-origin shaft pivot without changing length or scale', () => {
  const b = {
    gltfNodeIndex: 3,
    originalPath: '/shaft',
    role: 'input' as const,
    pivot: [0.01, 0.02, 0.03] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
  };
  const pose = cadBindingPose(b, undefined, 1.7, 0, 0, undefined),
    q = new Quaternion(...pose.rotation),
    t = new Vector3(...pose.translation);
  expect(
    new Vector3(...b.pivot)
      .applyQuaternion(q)
      .add(t)
      .distanceTo(new Vector3(...b.pivot)),
  ).toBeLessThan(1e-12);
});
it('illustrates tangential transport and two finite engagement zones without sampled profile penetration', () => {
  let minimum = Infinity,
    maximum = -Infinity;
  let worstMaterialResidual = 0;
  for (let j = 0; j < 121; j++) {
    const theta = (j * Math.PI * 2) / 120;
    for (let k = 0; k < 2400; k++) {
      const u = (k * Math.PI * 2) / 2400;
      const v = principlePoint(p, u, theta);
      const gap = principleRingRadius(p, v.phi) - v.radius;
      minimum = Math.min(minimum, gap);
      maximum = Math.max(maximum, gap);
      const thetaF = (-2 / 60) * theta;
      worstMaterialResidual = Math.max(
        worstMaterialResidual,
        Math.abs(v.phi - thetaF + Math.sin(2 * (v.phi - theta)) / 60 - u),
      );
    }
  }
  expect(minimum).toBeGreaterThanOrEqual(p.clearance - 1e-10);
  expect(maximum).toBeGreaterThan(0.0019);
  expect(worstMaterialResidual).toBeLessThan(1e-12);
  for (const theta of [0, 0.73, -1.2])
    for (const phi of [theta, theta + Math.PI]) {
      const u = phi + (2 / 60) * theta;
      const v = principlePoint(p, u, theta);
      expect(principleRingRadius(p, v.phi) - v.radius).toBeCloseTo(p.clearance, 10);
    }
});
