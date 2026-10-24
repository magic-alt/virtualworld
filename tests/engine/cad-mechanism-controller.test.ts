import { expect, it } from 'vitest';
import { MechanismController } from '../../packages/engine/src/mechanism';
import { DEMO_JOINT_DYNAMICS } from '@virtualworld/engine/joint-dynamics';
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
