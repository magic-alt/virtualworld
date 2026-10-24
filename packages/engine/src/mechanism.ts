import { JointDynamics, type JointSnapshot } from './joint-dynamics';
import type { JointDynamicsConfig } from '@virtualworld/scene-schema';
export function harmonicState(
  inputAngle: number,
  inputRpm: number,
  flexTeeth: number,
  ringTeeth: number,
) {
  const ratio = -(ringTeeth - flexTeeth) / flexTeeth,
    outputAngle = inputAngle * ratio;
  return {
    inputAngle,
    outputAngle,
    inputRpm,
    outputRpm: inputRpm * ratio,
    ratio,
    cos: Math.cos(2 * (inputAngle - outputAngle)),
    sin: Math.sin(2 * (inputAngle - outputAngle)),
  };
}

export type MechanismState = ReturnType<typeof harmonicState> & {
  moving: boolean;
  paused: boolean;
  actualInputRpm: number;
  actualOutputRpm: number;
  brakeInstalled: boolean;
  brakePowered: boolean;
  ratioKnown: boolean;
  dynamics?: JointSnapshot;
  timeScale: number;
};

/** Renderer-independent transient state. Nothing here edits the authored SceneSpec. */
export class MechanismController {
  private angle = 0;
  private speed = 6;
  private moving = false;
  private paused = false;
  private installed: boolean;
  private powered = true;
  private disposed = false;
  private listeners = new Set<(state: MechanismState) => void>();
  private dynamics?: JointDynamics;
  private timeScale = 1;
  constructor(
    private config: {
      kind?: string;
      flexTeeth?: number;
      ringTeeth?: number;
      hasBrake: boolean;
      dynamics?: JointDynamicsConfig;
      gear?: { status: string; flexTeeth?: number; ringTeeth?: number };
    },
  ) {
    this.installed = config.hasBrake;
    if (config.kind === 'cad-joint') {
      this.dynamics = new JointDynamics(config.dynamics);
      this.dynamics.setInstalled(config.hasBrake);
    }
  }
  snapshot(): MechanismState {
    if (this.dynamics) {
      const d = this.dynamics.snapshot();
      const ratioKnown = this.config.gear?.status === 'evidenced';
      const ratio = ratioKnown
        ? -(this.config.gear!.ringTeeth! - this.config.gear!.flexTeeth!) /
          this.config.gear!.flexTeeth!
        : 0;
      const inputAngle = d.angle + this.angle;
      const rpm = this.paused ? 0 : (d.omega * 30) / Math.PI;
      return {
        inputAngle,
        outputAngle: inputAngle * ratio,
        inputRpm: this.speed,
        outputRpm: this.speed * ratio,
        ratio,
        cos: 0,
        sin: 0,
        moving: d.running,
        paused: this.paused,
        actualInputRpm: rpm,
        actualOutputRpm: rpm * ratio,
        brakeInstalled: d.installed,
        brakePowered: d.powered,
        ratioKnown,
        dynamics: d,
        timeScale: this.timeScale,
      };
    }
    const state = harmonicState(
      this.angle,
      this.speed,
      this.config.flexTeeth!,
      this.config.ringTeeth!,
    );
    const actualInputRpm = this.moving && !this.paused && !this.locked ? this.speed : 0;
    return {
      ...state,
      moving: this.moving,
      paused: this.paused,
      actualInputRpm,
      actualOutputRpm: actualInputRpm * state.ratio,
      brakeInstalled: this.installed,
      brakePowered: this.powered,
      ratioKnown: true,
      timeScale: this.timeScale,
    };
  }
  private get locked() {
    return this.installed && !this.powered;
  }
  subscribe(listener: (state: MechanismState) => void) {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot());
  }
  setMoving(enabled: boolean) {
    if (this.dynamics) {
      if (enabled) this.dynamics.start();
      else this.dynamics.stop();
      this.emit();
      return;
    }
    this.moving = enabled && !this.locked;
    this.emit();
  }
  setSpeed(rpm: number) {
    if (Number.isFinite(rpm)) {
      this.speed = Math.max(-30, Math.min(30, rpm));
      this.dynamics?.setRpm(this.speed);
      this.emit();
    }
  }
  step(radians: number) {
    const state = this.snapshot();
    if (
      state.moving ||
      this.paused ||
      (state.brakeInstalled && !state.brakePowered) ||
      Math.abs(state.actualInputRpm) > 1e-10 ||
      !Number.isFinite(radians)
    )
      return;
    this.angle += radians;
    this.emit();
  }
  resetMotion() {
    this.angle = 0;
    if (this.dynamics) {
      this.dynamics.reset();
      this.speed = 6;
      this.timeScale = 1;
    }
    this.moving = false;
    this.emit();
  }
  setBrakeInstalled(installed: boolean) {
    if (this.dynamics) {
      this.dynamics.stop();
      this.dynamics.setInstalled(installed && this.config.hasBrake);
      this.dynamics.setPowered(true);
      this.emit();
      return;
    }
    this.installed = installed && this.config.hasBrake;
    this.powered = true;
    this.moving = false;
    this.emit();
  }
  setBrakePowered(powered: boolean) {
    if (this.dynamics) {
      if (this.dynamics.snapshot().installed) this.dynamics.setPowered(powered);
      this.emit();
      return;
    }
    if (!this.installed) return;
    this.powered = powered;
    this.moving = false;
    this.emit();
  }
  setTimeScale(value: number) {
    if ([1, 0.1, 0.02].includes(value)) {
      this.timeScale = value;
      this.emit();
    }
  }
  tick(dt: number, paused: boolean) {
    if (this.dynamics) {
      this.paused = paused;
      this.dynamics.tick(Number.isFinite(dt) && dt > 0 ? dt : 0, {
        paused,
        timeScale: this.timeScale,
      });
      this.emit();
      return;
    }
    const changed = this.paused !== paused;
    this.paused = paused;
    const rpm = this.snapshot().actualInputRpm;
    if (rpm && Number.isFinite(dt) && dt > 0) this.angle += ((rpm * Math.PI * 2) / 60) * dt;
    if (changed || (rpm && dt > 0)) this.emit();
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
