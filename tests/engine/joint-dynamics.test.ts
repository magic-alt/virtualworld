import { describe, expect, it } from 'vitest';
import {
  JointDynamics,
  rollingState,
  DEMO_JOINT_DYNAMICS,
} from '@virtualworld/engine/joint-dynamics';
import {
  CadMechanismSchema,
  JointDynamicsSchema,
  applyCommands,
  assertScene,
} from '@virtualworld/scene-schema';
import { worldDemo } from '../fixtures/scenes';
import scenarios from '../fixtures/joint-dynamics-scenarios.json';

const config = {
  ...DEMO_JOINT_DYNAMICS,
  inertia: 0.01,
  driveTorque: 1,
  brakeTorque: 2,
  holdTorque: 2,
  viscousDrag: 0,
  engageDelay: 0.1,
  engageRamp: 0.2,
  releaseDelay: 0.1,
  releaseRamp: 0.2,
};
const accelerated = () => {
  const d = new JointDynamics(config);
  d.setRpm(60);
  expect(d.start()).toBe(true);
  d.tick(0.2);
  return d;
};
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('radial bearing rolling constraints', () => {
  it.each([
    [2, 0],
    [-2, 0],
    [0, 3],
    [2, -3],
  ])('satisfies both world contact velocities for ring rates %s %s', (inner, outer) => {
    const s = rollingState(inner, outer, 0.02, 0.003);
    expect(Math.abs(s.cageAngle * 0.02 - s.worldBallAngle * 0.003 - inner * 0.017)).toBeLessThan(
      1e-10,
    );
    expect(Math.abs(s.cageAngle * 0.02 + s.worldBallAngle * 0.003 - outer * 0.023)).toBeLessThan(
      1e-10,
    );
    close(s.worldBallAngle, s.relativeBallAngle + s.cageAngle);
  });
  it.each([
    [0, 0.003],
    [0.02, 0],
    [0.02, 0.03],
    [Infinity, 1],
  ])('rejects impossible bearing radii %s %s', (r, b) =>
    expect(() => rollingState(0, 0, r, b)).toThrow(),
  );
});
describe('joint dynamics', () => {
  it.each([1e-12, -1e-12])(
    'brakes tiny nonzero RPM %s without reversing or creating energy',
    (rpm) => {
      const d = new JointDynamics({ ...DEMO_JOINT_DYNAMICS, viscousDrag: 0 });
      d.setRpm(rpm);
      d.start();
      d.tick(0.1);
      const before = d.snapshot();
      d.setPowered(false);
      d.tick(0.1);
      const after = d.snapshot();
      expect(Math.sign(before.omega)).toBe(Math.sign(rpm));
      expect(after.omega).toBe(0);
      expect((after.angle - before.angle) * Math.sign(rpm)).toBeGreaterThanOrEqual(0);
      expect(Math.abs(after.angle - before.angle)).toBeLessThan(Math.abs(before.omega) * 0.1);
      const lost = after.dissipatedEnergy - before.dissipatedEnergy;
      expect(lost).toBeGreaterThanOrEqual(0);
      expect(Math.abs(lost - before.kineticEnergy)).toBeLessThan(before.kineticEnergy * 1e-9);
    },
  );
  it.each([1e-12, -1e-12])(
    'stops tiny nonzero RPM %s with the physical torque-limited stopping angle',
    (rpm) => {
      const d = new JointDynamics({ ...DEMO_JOINT_DYNAMICS, viscousDrag: 0 });
      d.setRpm(rpm);
      d.start();
      d.tick(0.1);
      const before = d.snapshot();
      d.stop();
      const stoppingTime =
        (Math.abs(before.omega) * DEMO_JOINT_DYNAMICS.inertia) / DEMO_JOINT_DYNAMICS.driveTorque;
      d.tick(stoppingTime / 2);
      expect(Math.abs(d.snapshot().omega - before.omega / 2)).toBeLessThan(
        Math.abs(before.omega) * 1e-12,
      );
      d.tick(0.1);
      const after = d.snapshot();
      expect(after.omega).toBe(0);
      const expected =
        (before.omega * Math.abs(before.omega) * DEMO_JOINT_DYNAMICS.inertia) /
        (2 * DEMO_JOINT_DYNAMICS.driveTorque);
      // At this scale the increment is below the existing angle's ULP. Validate energy too.
      expect(Math.abs(after.angle - before.angle - expected)).toBeLessThan(
        Math.abs(before.angle) * Number.EPSILON,
      );
      // Motor work absorbs kinetic energy; released friction/drag must not invent heat.
      expect(Math.abs(after.dissipatedEnergy - before.dissipatedEnergy)).toBeLessThan(
        before.kineticEnergy * 1e-9,
      );
    },
  );
  it('preserves speed during power-off delay then dissipates energy without reversing', () => {
    const d = accelerated();
    const before = d.snapshot();
    d.setPowered(false);
    d.tick(0.1);
    close(d.snapshot().omega, before.omega);
    close(d.snapshot().angle - before.angle, before.omega * 0.1);
    for (let i = 0; i < 40; i++) {
      d.tick(0.01);
      expect(d.snapshot().omega).toBeGreaterThanOrEqual(0);
    }
    expect(d.snapshot().omega).toBe(0);
    expect(d.snapshot().dissipatedEnergy).toBeGreaterThan(0);
    expect(d.snapshot().brakePhase).toBe('holding');
  });
  it('requires full release and a new start request after power returns', () => {
    const d = accelerated();
    d.setPowered(false);
    d.tick(1);
    d.setPowered(true);
    expect(d.start()).toBe(false);
    d.tick(1);
    expect(d.snapshot().omega).toBe(0);
    expect(d.snapshot().running).toBe(false);
    expect(d.start()).toBe(true);
    d.tick(0.1);
    expect(d.snapshot().omega).toBeGreaterThan(0);
  });
  it('preserves closure on mid-transition toggles and does not resume automatically', () => {
    const d = accelerated();
    d.setPowered(false);
    d.tick(0.2);
    close(d.snapshot().closure, 0.5);
    d.setPowered(true);
    close(d.snapshot().closure, 0.5);
    d.tick(0.1);
    close(d.snapshot().closure, 0.5);
    d.tick(0.1);
    close(d.snapshot().closure, 0);
    expect(d.snapshot().running).toBe(false);
    d.setPowered(false);
    d.tick(1);
    expect(d.snapshot().omega).toBe(0);
  });
  it('crosses zero before reaching reverse target without a velocity jump', () => {
    const d = accelerated();
    const before = d.snapshot().angle;
    d.setRpm(-60);
    d.tick(0.2);
    close(d.snapshot().angle - before, -2 * Math.PI * (0.2 - (4 * Math.PI) / 100));
  });
  it('uses bounded drive torque for reverse and ordinary stop', () => {
    const d = accelerated();
    d.setRpm(-60);
    d.tick(0.03);
    expect(d.snapshot().omega).toBeGreaterThan(0);
    d.tick(0.2);
    close(d.snapshot().omega, -2 * Math.PI);
    d.stop();
    d.tick(0.03);
    expect(d.snapshot().omega).toBeLessThan(0);
    d.tick(1);
    expect(d.snapshot().omega).toBe(0);
  });
  it('freezes all simulation timers on pause and scales elapsed simulation time', () => {
    const d = accelerated();
    d.setPowered(false);
    const before = d.snapshot();
    d.tick(10, { paused: true });
    expect(d.snapshot()).toEqual(before);
    d.tick(1, { timeScale: 0.05 });
    close(d.snapshot().time - before.time, 0.05);
    close(d.snapshot().closure, 0);
  });
  it('retains finite hold capacity and clears brake when uninstalled', () => {
    const d = accelerated();
    d.setPowered(false);
    d.tick(1);
    const held = d.snapshot().angle;
    d.tick(2);
    close(d.snapshot().angle, held);
    d.setInstalled(false);
    expect(d.snapshot().closure).toBe(0);
    expect(d.snapshot().brakePhase).toBe('uninstalled');
    d.setPowered(true);
    expect(d.start()).toBe(true);
    d.tick(0.1);
    expect(d.snapshot().omega).toBeGreaterThan(0);
  });
  it.each([5, 10, 20, 60])(
    'agrees with one elapsed interval at %s FPS through ramp, zero and release events',
    (fps) => {
      const run = (frame: number) => {
        const advance = (d: JointDynamics, t: number) => {
          for (let left = t; left > 1e-14; left -= Math.min(frame, left))
            d.tick(Math.min(frame, left));
        };
        const d = new JointDynamics({ ...config, viscousDrag: 0.003 });
        d.setRpm(97);
        d.start();
        advance(d, 0.4);
        d.setPowered(false);
        advance(d, 0.6);
        d.setPowered(true);
        advance(d, 0.4);
        d.start();
        d.setRpm(-43);
        advance(d, 0.8);
        return d.snapshot();
      };
      const a = run(Infinity),
        b = run(1 / fps);
      close(a.angle, b.angle);
      close(a.omega, b.omega);
      close(a.dissipatedEnergy, b.dissipatedEnergy);
    },
  );
  it('matches the analytic ramp stopping distance and kinetic energy loss', () => {
    const d = accelerated(),
      initial = d.snapshot();
    d.setPowered(false);
    d.tick(1);
    const stopTime = Math.sqrt((2 * Math.PI) / 500);
    close(d.snapshot().angle - initial.angle, 2 * Math.PI * 0.1 + (2 / 3) * 2 * Math.PI * stopTime);
    close(
      d.snapshot().dissipatedEnergy - initial.dissipatedEnergy,
      0.5 * 0.01 * (2 * Math.PI) ** 2,
    );
  });
  it('agrees across partitions when reversal crosses zero and target in a single frame', () => {
    const a = accelerated(),
      b = accelerated();
    a.setRpm(-60);
    b.setRpm(-60);
    a.tick(0.2);
    for (let i = 0; i < 60; i++) b.tick(0.2 / 60);
    close(a.snapshot().angle, b.snapshot().angle);
    close(a.snapshot().omega, b.snapshot().omega);
  });
  it.each(scenarios.scenarios)('replays shared JS/UE scenario $name', (scenario) => {
    const d = new JointDynamics(scenarios.config as typeof config);
    for (const action of scenario.actions) {
      let accepted: boolean | undefined;
      switch (action.method) {
        case 'start':
          accepted = d.start();
          break;
        case 'stop':
          d.stop();
          break;
        case 'setRpm':
          d.setRpm(action.args[0] as number);
          break;
        case 'setPowered':
          d.setPowered(action.args[0] as boolean);
          break;
        case 'setInstalled':
          d.setInstalled(action.args[0] as boolean);
          break;
        case 'tick':
          d.tick(
            action.args[0] as number,
            action.args[1] as { paused?: boolean; timeScale?: number },
          );
          break;
        default:
          throw new Error('Unsupported fixture action');
      }
      const actual = d.snapshot();
      for (const key of ['angle', 'omega', 'time', 'dissipatedEnergy', 'closure'] as const)
        close(actual[key], action.expected[key]);
      expect(actual.brakePhase).toBe(action.expected.brakePhase);
      expect(actual.running).toBe(action.expected.running);
      if (action.method === 'start')
        expect(accepted).toBe('accepted' in action ? action.accepted : undefined);
    }
  });
  it('handles zero-time transitions, reset and invalid numeric inputs', () => {
    const d = new JointDynamics({
      ...config,
      engageDelay: 0,
      engageRamp: 0,
      releaseDelay: 0,
      releaseRamp: 0,
    });
    d.start();
    d.tick(0.1);
    d.setPowered(false);
    expect(d.snapshot().closure).toBe(1);
    d.tick(1);
    expect(d.snapshot().omega).toBe(0);
    d.reset();
    expect(d.snapshot().time).toBe(0);
    expect(d.snapshot().angle).toBe(0);
    expect(() => d.tick(-1)).toThrow();
    expect(() => d.setRpm(NaN)).toThrow();
    expect(() => d.setRpm(100001)).toThrow();
    expect(() => new JointDynamics({ ...config, engageRamp: 1e-300 })).toThrow();
    expect(() => new JointDynamics({ ...config, inertia: 1e-300 })).toThrow();
    expect(() => new JointDynamics({ ...config, brakeTorque: 1e300 })).toThrow();
    expect(() => new JointDynamics({ ...config, inertia: 0 })).toThrow();
  });
});

describe('CAD mechanism scene commands', () => {
  const mechanism = () => ({
    kind: 'cad-joint' as const,
    modelNodeId: 'model',
    sourceSha256: 'a'.repeat(64),
    modelSha256: 'b'.repeat(64),
    bindings: [
      {
        gltfNodeIndex: 7,
        originalPath: 'assembly/ball',
        role: 'ball' as const,
        pivot: [0, 0, 0],
        axis: [0, 0, 1],
        bearingId: 'bearing',
      },
    ],
    bearings: [
      {
        id: 'bearing',
        innerSpeedFactor: 1,
        outerSpeedFactor: 0,
        pitchRadius: 0.015,
        ballRadius: 0.002,
      },
    ],
    gear: { status: 'unresolved' as const, notes: 'No tooth evidence' },
    dynamics: config,
    fixedNodeIds: [],
    fullHousingIds: [],
    sectionHousingIds: [],
    dimensions: {
      baseDiameter: 0.08,
      housingDiameter: 0.08,
      totalHeight: 0.098161,
      boreDiameter: 0.01,
    },
  });
  it('allows an atomic validated CAD configuration without inventing teeth or confirmation', () => {
    const scene = worldDemo();
    scene.nodes.push({
      id: 'model',
      name: 'CAD',
      kind: 'group',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      size: [1, 1, 1],
      color: '#ffffff',
      visible: true,
    });
    const original = JSON.stringify(scene);
    const next = applyCommands(scene, scene.revision, [
      { type: 'configureScene', patch: { mechanism: mechanism() } },
    ]);
    expect(next.mechanism?.kind).toBe('cad-joint');
    expect(JSON.stringify(scene)).toBe(original);
    expect(next.revision).toBe(scene.revision + 1);
    expect(() => assertScene(next)).not.toThrow();
    expect(() =>
      applyCommands(scene, scene.revision, [
        {
          type: 'configureScene',
          patch: { mechanism: { ...mechanism(), modelNodeId: 'missing' } },
        },
      ]),
    ).toThrow();
    expect(JSON.stringify(scene)).toBe(original);
  });
  it('requires the final serialized GLB hash and keeps illustrative geometry independent of gear evidence', () => {
    const { modelSha256, ...missing } = mechanism();
    expect(CadMechanismSchema.safeParse(missing).success).toBe(false);
    const principle = {
      kind: 'illustrative-harmonic',
      flexTeeth: 100,
      ringTeeth: 102,
      radius: 0.02,
      amplitude: 0.001,
      toothHeight: 0.0002,
      clearance: 0.0001,
      position: [0, 0, 0],
      label: 'Principle layer: illustrative assumptions',
    };
    expect(CadMechanismSchema.safeParse({ ...mechanism(), principle }).success).toBe(true);
    for (const invalid of [
      { ...principle, ringTeeth: 104 },
      { ...principle, amplitude: 0.01 },
      { ...principle, toothHeight: 0.001 },
    ])
      expect(CadMechanismSchema.safeParse({ ...mechanism(), principle: invalid }).success).toBe(
        false,
      );
  });
  it('accepts explicit stated reduction and mechanical roles without promoting user input to tooth evidence or confirmation', () => {
    const gear = {
      status: 'user-specified',
      reductionRatio: 101,
      fixedMember: 'flexspline',
      evidence: 'User supplied ratio; topology inferred from geometry',
    };
    const parsed = CadMechanismSchema.parse({
      ...mechanism(),
      gear,
      bindings: [
        { ...mechanism().bindings[0], role: 'flexspline', inspectionCut: true },
        { ...mechanism().bindings[0], gltfNodeIndex: 8, role: 'circular-spline' },
      ],
    });
    expect(parsed.gear).toEqual(gear);
    expect(parsed.dynamics.provenance).toBe('demonstration-assumption');
    for (const invalid of [
      { ...gear, reductionRatio: 0 },
      { ...gear, reductionRatio: -101 },
      { ...gear, reductionRatio: Infinity },
      { ...gear, fixedMember: 'unknown' },
      { ...gear, evidence: '' },
      { ...gear, confirmed: true },
      { ...gear, flexTeeth: 200, ringTeeth: 202 },
    ])
      expect(CadMechanismSchema.safeParse({ ...mechanism(), gear: invalid }).success).toBe(false);
    expect(
      CadMechanismSchema.safeParse({
        ...mechanism(),
        gear: {
          status: 'evidenced',
          flexTeeth: 200,
          ringTeeth: 202,
          fixedRing: true,
          evidence: 'Measured fixture',
        },
      }).success,
    ).toBe(true);
  });
  it('rejects invalid source, duplicate mesh bindings, unsupported bearings and invented confirmation', () => {
    expect(CadMechanismSchema.safeParse({ ...mechanism(), sourceSha256: 'unknown' }).success).toBe(
      false,
    );
    expect(
      CadMechanismSchema.safeParse({
        ...mechanism(),
        bindings: [...mechanism().bindings, ...mechanism().bindings],
      }).success,
    ).toBe(false);
    expect(
      CadMechanismSchema.safeParse({
        ...mechanism(),
        bearings: [{ ...mechanism().bearings[0], ballRadius: 0.02 }],
      }).success,
    ).toBe(false);
    expect(JointDynamicsSchema.safeParse({ ...config, confirmed: true }).success).toBe(false);
    expect(
      JointDynamicsSchema.safeParse({ ...config, holdTorque: config.brakeTorque / 2 }).success,
    ).toBe(false);
  });
});
