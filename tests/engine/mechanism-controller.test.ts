import { expect, it } from 'vitest';
import * as mechanism from '../../packages/engine/src/mechanism';

it('preserves phase on pause, separates actual speed, clamps input and steps only while stopped', () => {
  expect(mechanism.MechanismController).toBeTypeOf('function');
  const c = new mechanism.MechanismController({ flexTeeth: 200, ringTeeth: 202, hasBrake: true });
  expect(c.snapshot().inputRpm).toBe(6);
  expect(c.snapshot().actualInputRpm).toBe(0);
  c.setMoving(true);
  c.tick(10, false);
  expect(c.snapshot().inputAngle).toBeCloseTo(Math.PI * 2);
  expect(c.snapshot().outputAngle).toBeCloseTo(-Math.PI / 50);
  c.setMoving(false);
  c.tick(1, false);
  expect(c.snapshot().inputAngle).toBeCloseTo(Math.PI * 2);
  c.step(Math.PI / 12);
  expect(c.snapshot().inputAngle).toBeCloseTo(Math.PI * 2 + Math.PI / 12);
  c.setSpeed(-100);
  c.setSpeed(NaN);
  expect(c.snapshot().inputRpm).toBe(-30);
  c.setMoving(true);
  const before = c.snapshot().inputAngle;
  c.step(1);
  expect(c.snapshot().inputAngle).toBe(before);
  c.tick(1, true);
  expect(c.snapshot().actualInputRpm).toBe(0);
  expect(c.snapshot().inputAngle).toBe(before);
  c.tick(1, false);
  expect(c.snapshot().actualOutputRpm).toBeCloseTo(0.3);
  c.resetMotion();
  expect(c.snapshot().inputAngle).toBe(0);
  expect(c.snapshot().moving).toBe(false);
});

it('locks the installed permanent magnet brake and requires an explicit restart after release', () => {
  expect(mechanism.MechanismController).toBeTypeOf('function');
  const c = new mechanism.MechanismController({ flexTeeth: 200, ringTeeth: 202, hasBrake: true });
  c.setMoving(true);
  c.tick(1, false);
  const angle = c.snapshot().inputAngle;
  c.setBrakePowered(false);
  c.setMoving(true);
  c.step(1);
  c.tick(10, false);
  expect(c.snapshot().inputAngle).toBe(angle);
  expect(c.snapshot().actualInputRpm).toBe(0);
  c.setBrakePowered(true);
  c.tick(1, false);
  expect(c.snapshot().moving).toBe(false);
  c.setBrakeInstalled(false);
  c.setBrakePowered(false);
  expect(c.snapshot().brakePowered).toBe(true);
  c.setMoving(true);
  c.tick(1, false);
  expect(c.snapshot().inputAngle).toBeGreaterThan(angle);
});

it('unsubscribes and releases listeners on disposal without sharing mutable snapshots', () => {
  expect(mechanism.MechanismController).toBeTypeOf('function');
  const c = new mechanism.MechanismController({ flexTeeth: 200, ringTeeth: 202, hasBrake: false });
  let count = 0;
  const unsubscribe = c.subscribe((s) => {
    count++;
    s.inputRpm = 900;
  });
  expect(c.snapshot().inputRpm).toBe(6);
  c.setSpeed(12);
  expect(count).toBe(2);
  unsubscribe();
  c.setSpeed(15);
  expect(count).toBe(2);
  c.subscribe(() => count++);
  c.dispose();
  c.setSpeed(20);
  expect(count).toBe(3);
});
