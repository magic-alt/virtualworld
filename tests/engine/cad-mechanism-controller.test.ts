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
