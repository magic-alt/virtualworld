import { expect, it } from 'vitest';
import { MechanismController } from '../../packages/engine/src/mechanism';
import { DEMO_JOINT_DYNAMICS } from '@virtualworld/engine/joint-dynamics';
it('starts and resets the authored 1000 RPM motor default while retaining 101 reduction and usable speed controls', () => {
  const c = new MechanismController({
    kind: 'cad-joint',
    hasBrake: true,
    defaultRpm: 1000,
    dynamics: DEMO_JOINT_DYNAMICS,
    gear: {
      status: 'user-specified',
      reductionRatio: 101,
      fixedMember: 'flexspline',
      evidence: 'User configuration',
    },
  });
  expect(c.snapshot()).toMatchObject({ inputRpm: 1000, actualInputRpm: 0, timeScale: 1 });
  expect(c.snapshot().dynamics?.targetRpm).toBe(1000);
  c.setMoving(true);
  c.tick(2, false);
  expect(c.snapshot().actualInputRpm).toBeCloseTo(1000, 8);
  expect(c.snapshot().actualOutputRpm).toBeCloseTo(1000 / 101, 8);
  c.setSpeed(1001);
  expect(c.snapshot().inputRpm).toBe(1001);
  c.setTimeScale(0.1);
  c.resetMotion();
  expect(c.snapshot()).toMatchObject({
    inputRpm: 1000,
    actualInputRpm: 0,
    moving: false,
    timeScale: 1,
  });
  expect(c.snapshot().dynamics?.targetRpm).toBe(1000);
});
it('reports actual user-stated output speed and signed 101-turn motion without asserting measured teeth', () => {
  const gear = {
    status: 'user-specified' as const,
    reductionRatio: 101,
    fixedMember: 'flexspline' as const,
    evidence: 'User stated 101',
  };
  const c = new MechanismController({
    kind: 'cad-joint',
    hasBrake: true,
    dynamics: DEMO_JOINT_DYNAMICS,
    gear,
  });
  expect(c.snapshot().ratioKnown).toBe(true);
  for (const sign of [-1, 1]) {
    c.resetMotion();
    c.step(sign * 101 * 2 * Math.PI);
    expect(c.snapshot().outputAngle).toBeCloseTo(sign * 2 * Math.PI, 12);
  }
  c.resetMotion();
  c.setMoving(true);
  c.tick(0.1, false);
  expect(c.snapshot().actualOutputRpm).toBeCloseTo(6 / 101, 10);
  c.tick(1, true);
  expect(c.snapshot().actualOutputRpm).toBe(0);
});

it('accelerates the entire CAD clock for inspection while preserving output ratio and brake stopping', () => {
  const gear = {
    status: 'user-specified' as const,
    reductionRatio: 101,
    fixedMember: 'flexspline' as const,
    evidence: 'User stated 101',
  };
  for (const scale of [10, 50]) {
    const c = new MechanismController({
      kind: 'cad-joint',
      hasBrake: true,
      dynamics: DEMO_JOINT_DYNAMICS,
      gear,
    });
    c.setTimeScale(scale);
    c.setMoving(true);
    c.tick(0.1, false);
    expect(c.snapshot().dynamics!.time).toBeCloseTo(0.1 * scale, 10);
    expect(c.snapshot().outputAngle).toBeCloseTo(c.snapshot().inputAngle / 101, 12);
    c.setBrakePowered(false);
    c.tick(0.1, false);
    expect(c.snapshot().actualOutputRpm).toBe(0);
    c.setBrakePowered(true);
    c.tick(0.1, false);
    expect(c.snapshot().moving).toBe(false);
  }
});
it('uses continuous CAD dynamics, release interlock and a frozen slow-motion clock without inventing output ratio', () => {
  const c = new MechanismController({
    kind: 'cad-joint',
    hasBrake: true,
    dynamics: DEMO_JOINT_DYNAMICS,
  });
  expect(c.snapshot().ratioKnown).toBe(false);
  c.setMoving(true);
  c.tick(0.1, false);
  expect(c.snapshot().actualInputRpm).toBeCloseTo(6, 6);
  const before = c.snapshot().inputAngle;
  c.setBrakePowered(false);
  expect(c.snapshot().actualInputRpm).toBeGreaterThan(0);
  c.tick(0.01, false);
  expect(c.snapshot().inputAngle).toBeGreaterThan(before);
  expect(c.snapshot().dynamics?.brakePhase).toBe('engage-delay');
  const frozen = c.snapshot();
  c.tick(10, true);
  expect(c.snapshot().dynamics?.time).toBe(frozen.dynamics?.time);
  c.setTimeScale(0.1);
  c.tick(0.1, false);
  expect(c.snapshot().dynamics!.time - frozen.dynamics!.time).toBeCloseTo(0.01, 10);
  c.tick(1, false);
  expect(c.snapshot().actualInputRpm).toBe(0);
  c.setBrakePowered(true);
  c.setMoving(true);
  expect(c.snapshot().moving).toBe(false);
  c.tick(1, false);
  expect(c.snapshot().moving).toBe(false);
  c.setMoving(true);
  c.tick(0.1, false);
  expect(c.snapshot().actualInputRpm).toBeGreaterThan(0);
});
it('requires a fresh explicit start after removal from holding, motion, and release', () => {
  const c = new MechanismController({
    kind: 'cad-joint',
    hasBrake: true,
    dynamics: DEMO_JOINT_DYNAMICS,
  });
  c.setMoving(true);
  c.tick(0.1, false);
  c.setBrakePowered(false);
  c.tick(1, false);
  expect(c.snapshot().dynamics!.brakePhase).toBe('holding');
  c.setBrakeInstalled(false);
  expect(c.snapshot()).toMatchObject({ brakeInstalled: false, brakePowered: true, moving: false });
  c.setMoving(true);
  c.tick(0.1, false);
  expect(c.snapshot().actualInputRpm).toBeGreaterThan(0);
  c.setBrakeInstalled(true);
  expect(c.snapshot().moving).toBe(false);
  c.tick(1, false);
  c.setMoving(true);
  c.tick(0.1, false);
  const before = c.snapshot().actualInputRpm;
  c.setBrakeInstalled(false);
  expect(c.snapshot().moving).toBe(false);
  expect(c.snapshot().actualInputRpm).toBe(before);
  c.tick(0.001, false);
  expect(c.snapshot().actualInputRpm).toBeGreaterThan(0);
  expect(c.snapshot().actualInputRpm).toBeLessThan(before);
  c.tick(1, false);
  expect(c.snapshot().actualInputRpm).toBe(0);
  c.setBrakeInstalled(true);
  c.setBrakePowered(false);
  c.tick(1, false);
  c.setBrakePowered(true);
  c.tick(0.03, false);
  expect(c.snapshot().dynamics!.closure).toBeGreaterThan(0);
  expect(c.snapshot().dynamics!.closure).toBeLessThan(1);
  c.setBrakeInstalled(false);
  expect(c.snapshot().moving).toBe(false);
  c.setMoving(true);
  expect(c.snapshot().moving).toBe(true);
});
it('resets CAD motion to the initial 6 RPM setpoint and real-time clock just as native Zero does', () => {
  const c = new MechanismController({
    kind: 'cad-joint',
    hasBrake: true,
    dynamics: DEMO_JOINT_DYNAMICS,
  });
  c.setSpeed(-18);
  c.setTimeScale(0.02);
  c.setMoving(true);
  c.tick(0.3, false);
  c.setBrakeInstalled(false);
  c.resetMotion();
  expect(c.snapshot()).toMatchObject({
    inputAngle: 0,
    inputRpm: 6,
    actualInputRpm: 0,
    timeScale: 1,
    moving: false,
    brakeInstalled: true,
    brakePowered: true,
  });
  expect(c.snapshot().dynamics).toMatchObject({
    angle: 0,
    time: 0,
    omega: 0,
    targetRpm: 6,
    dissipatedEnergy: 0,
    closure: 0,
  });
  c.setMoving(true);
  c.tick(0.1, false);
  expect(c.snapshot().actualInputRpm).toBeCloseTo(6, 10);
});
