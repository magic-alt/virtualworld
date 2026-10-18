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
  constructor(private config: { flexTeeth: number; ringTeeth: number; hasBrake: boolean }) {
    this.installed = config.hasBrake;
  }
  snapshot(): MechanismState {
    const state = harmonicState(
      this.angle,
      this.speed,
      this.config.flexTeeth,
      this.config.ringTeeth,
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
    this.moving = enabled && !this.locked;
    this.emit();
  }
  setSpeed(rpm: number) {
    if (Number.isFinite(rpm)) {
      this.speed = Math.max(-30, Math.min(30, rpm));
      this.emit();
    }
  }
  step(radians: number) {
    if (this.moving || this.paused || this.locked || !Number.isFinite(radians)) return;
    this.angle += radians;
    this.emit();
  }
  resetMotion() {
    this.angle = 0;
    this.moving = false;
    this.emit();
  }
  setBrakeInstalled(installed: boolean) {
    this.installed = installed && this.config.hasBrake;
    this.powered = true;
    this.moving = false;
    this.emit();
  }
  setBrakePowered(powered: boolean) {
    if (!this.installed) return;
    this.powered = powered;
    this.moving = false;
    this.emit();
  }
  tick(dt: number, paused: boolean) {
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
