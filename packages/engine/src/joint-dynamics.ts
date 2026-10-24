import { JointDynamicsSchema, type JointDynamicsConfig } from '@virtualworld/scene-schema';

/** Intentionally uncalibrated SI preset; none of these values are vendor ratings. */
export const DEMO_JOINT_DYNAMICS: JointDynamicsConfig = {
  inertia: 0.00012,
  driveTorque: 0.012,
  brakeTorque: 0.06,
  holdTorque: 0.08,
  viscousDrag: 0.00002,
  engageDelay: 0.025,
  engageRamp: 0.04,
  releaseDelay: 0.02,
  releaseRamp: 0.035,
  armatureTravel: 0.00015,
  provenance: 'demonstration-assumption',
  notes:
    'Illustrative equivalent shaft values chosen for visible transitions; no measurement, vendor rating or human confirmation.',
};

/** Angles or angular rates obey the same linear radial, no-slip constraint. */
export function rollingState(
  innerAngle: number,
  outerAngle: number,
  pitchRadius: number,
  ballRadius: number,
) {
  if (
    ![innerAngle, outerAngle, pitchRadius, ballRadius].every(Number.isFinite) ||
    ballRadius <= 0 ||
    pitchRadius <= ballRadius
  )
    throw new Error('Rolling state requires finite angles and 0 < ballRadius < pitchRadius');
  const ri = pitchRadius - ballRadius,
    ro = pitchRadius + ballRadius;
  const cageAngle = (innerAngle * ri + outerAngle * ro) / (2 * pitchRadius);
  const relativeBallAngle = ((outerAngle - innerAngle) * ri * ro) / (2 * pitchRadius * ballRadius);
  return { cageAngle, relativeBallAngle, worldBallAngle: cageAngle + relativeBallAngle };
}
export type BrakePhase =
  | 'uninstalled'
  | 'released'
  | 'engage-delay'
  | 'engaging'
  | 'slipping'
  | 'holding'
  | 'release-delay'
  | 'releasing';
export interface JointSnapshot {
  angle: number;
  omega: number;
  time: number;
  dissipatedEnergy: number;
  kineticEnergy: number;
  closure: number;
  brakePhase: BrakePhase;
  powered: boolean;
  installed: boolean;
  running: boolean;
  targetRpm: number;
}
export interface JointTickOptions {
  paused?: boolean;
  timeScale?: number;
}

/** Exact integrals for omega' = a + b*t - k*omega. Stable also as drag tends to zero. */
function integrate(omega: number, a: number, b: number, k: number, t: number) {
  const x = k * t;
  let i0: number, i1: number, i2: number;
  if (Math.abs(x) < 0.05) {
    // phi-function series avoids subtracting nearly equal terms in the angle integral.
    let term = 1,
      p0 = 1,
      p1 = 0.5,
      p2 = 1 / 6;
    for (let n = 1; n < 12; n++) {
      term *= -x / n;
      p0 += term / (n + 1);
      p1 += term / ((n + 1) * (n + 2));
      p2 += term / ((n + 1) * (n + 2) * (n + 3));
    }
    i0 = t * p0;
    i1 = t * t * p1;
    i2 = t * t * t * p2;
  } else {
    i0 = -Math.expm1(-x) / k;
    i1 = (t - i0) / k;
    i2 = ((t * t) / 2 - i1) / k;
  }
  return { omega: omega * Math.exp(-x) + a * i0 + b * i1, angle: omega * i0 + a * i1 + b * i2 };
}

/** One equivalent shaft, Coulomb brake and viscous drag. No runtime state enters SceneSpec. */
export class JointDynamics {
  readonly config: JointDynamicsConfig;
  private angle = 0;
  private omega = 0;
  private time = 0;
  private dissipatedEnergy = 0;
  private closure = 0;
  private powered = true;
  private installed = true;
  private running = false;
  private stopping = false;
  private targetRpm = 6;
  private delay = 0;
  private transitioning = false;
  constructor(config: JointDynamicsConfig = DEMO_JOINT_DYNAMICS) {
    this.config = Object.freeze(JointDynamicsSchema.parse(config));
  }
  start(): boolean {
    if (!this.powered || (this.installed && (this.closure !== 0 || this.transitioning)))
      return false;
    this.running = true;
    this.stopping = false;
    return true;
  }
  stop() {
    this.running = false;
    this.stopping = true;
  }
  setRpm(rpm: number) {
    if (!Number.isFinite(rpm) || Math.abs(rpm) > 100000)
      throw new Error('RPM must be finite and within ±100000');
    this.targetRpm = rpm;
  }
  setPowered(powered: boolean) {
    if (this.powered === powered) return;
    this.powered = powered;
    if (!powered) {
      this.running = false;
      this.stopping = false;
    }
    this.beginTransition();
  }
  setInstalled(installed: boolean) {
    if (this.installed === installed) return;
    this.installed = installed;
    if (!installed) {
      this.closure = 0;
      this.delay = 0;
      this.transitioning = false;
    } else this.beginTransition();
  }
  reset() {
    this.angle = this.omega = this.time = this.dissipatedEnergy = this.closure = this.delay = 0;
    this.powered = this.installed = true;
    this.running = this.stopping = this.transitioning = false;
    this.targetRpm = 6;
  }
  snapshot(): JointSnapshot {
    let brakePhase: BrakePhase;
    if (!this.installed) brakePhase = 'uninstalled';
    else if (this.transitioning && this.delay > 0)
      brakePhase = this.powered ? 'release-delay' : 'engage-delay';
    else if (this.transitioning) brakePhase = this.powered ? 'releasing' : 'engaging';
    else if (this.closure === 0) brakePhase = 'released';
    else brakePhase = this.omega === 0 ? 'holding' : 'slipping';
    return {
      angle: this.angle,
      omega: this.omega,
      time: this.time,
      dissipatedEnergy: this.dissipatedEnergy,
      kineticEnergy: 0.5 * this.config.inertia * this.omega ** 2,
      closure: this.closure,
      brakePhase,
      powered: this.powered,
      installed: this.installed,
      running: this.running,
      targetRpm: this.targetRpm,
    };
  }
  tick(elapsed: number, options: JointTickOptions = {}): JointSnapshot {
    const scale = options.timeScale ?? 1;
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      !Number.isFinite(scale) ||
      scale < 0 ||
      !Number.isFinite(elapsed * scale)
    )
      throw new Error('Elapsed time and scale must be finite and nonnegative');
    if (options.paused || elapsed === 0 || scale === 0) return this.snapshot();
    let remaining = elapsed * scale;
    while (remaining > 0) {
      this.resolveInstantTransition();
      let duration = remaining,
        slope = 0;
      if (this.transitioning) {
        if (this.delay > 0) duration = Math.min(duration, this.delay);
        else {
          const ramp = this.powered ? this.config.releaseRamp : this.config.engageRamp;
          slope = (this.powered ? -1 : 1) / ramp;
          duration = Math.min(
            duration,
            this.powered ? this.closure * ramp : (1 - this.closure) * ramp,
          );
        }
      }
      this.advanceShaft(duration, slope);
      this.time += duration;
      if (this.transitioning && this.delay > 0) this.delay = Math.max(0, this.delay - duration);
      else this.closure = Math.max(0, Math.min(1, this.closure + slope * duration));
      remaining = Math.max(0, remaining - duration);
      if (
        this.transitioning &&
        this.delay === 0 &&
        ((this.powered && this.closure < 1e-14) || (!this.powered && 1 - this.closure < 1e-14))
      ) {
        this.closure = this.powered ? 0 : 1;
        this.transitioning = false;
      }
    }
    this.resolveInstantTransition();
    return this.snapshot();
  }
  private beginTransition() {
    if (!this.installed) return;
    const target = this.powered ? 0 : 1;
    if (this.closure === target) {
      this.transitioning = false;
      this.delay = 0;
      return;
    }
    this.delay = this.powered ? this.config.releaseDelay : this.config.engageDelay;
    this.transitioning = true;
    this.resolveInstantTransition();
  }
  private resolveInstantTransition() {
    if (!this.transitioning || this.delay > 0) return;
    if ((this.powered ? this.config.releaseRamp : this.config.engageRamp) === 0) {
      this.closure = this.powered ? 0 : 1;
      this.transitioning = false;
    }
  }
  private advanceShaft(duration: number, slope: number) {
    const c = this.config,
      k = c.viscousDrag / c.inertia;
    let remaining = duration,
      local = 0;
    while (remaining > 0) {
      const closure = this.closure + slope * local;
      const motor = this.powered && (this.running || this.stopping);
      const target = this.running ? (this.targetRpm * Math.PI) / 30 : 0;
      let drive = motor ? Math.sign(target - this.omega) * c.driveTorque : 0;
      let h = remaining;
      const atTarget = motor && Math.abs(this.omega - target) < 1e-12;
      if (atTarget && target !== 0) {
        this.omega = target;
        const required = c.brakeTorque * closure + c.viscousDrag * Math.abs(target);
        if (required <= c.driveTorque + 1e-14) {
          if (slope > 0)
            h = Math.min(h, Math.max(0, (c.driveTorque - required) / (c.brakeTorque * slope)));
          if (h > 1e-13) {
            this.angle += target * h;
            this.dissipatedEnergy +=
              Math.abs(target) * c.brakeTorque * (closure * h + (slope * h * h) / 2) +
              c.viscousDrag * target * target * h;
            local += h;
            remaining = Math.max(0, remaining - h);
            continue;
          }
        }
        drive = Math.sign(target) * c.driveTorque;
      }
      if (this.omega === 0) {
        if (Math.abs(drive) <= c.holdTorque * closure) {
          if (slope < 0 && drive !== 0)
            h = Math.min(h, Math.max(0, (closure - Math.abs(drive) / c.holdTorque) / -slope));
          if (h > 1e-13) {
            local += h;
            remaining = Math.max(0, remaining - h);
            continue;
          }
        }
        if (drive === 0) {
          local += h;
          remaining = Math.max(0, remaining - h);
          continue;
        }
      }
      const sign = Math.sign(this.omega) || Math.sign(drive);
      const a = (drive - sign * c.brakeTorque * closure) / c.inertia;
      const b = (-sign * c.brakeTorque * slope) / c.inertia;
      // A linear forcing has at most one extremum. Split there before seeking roots.
      const derivative = a - k * this.omega;
      let extremum = Infinity;
      if (k === 0 && b !== 0) extremum = -derivative / b;
      else if (k > 0 && b !== 0) {
        const ratio = -b / k / (derivative - b / k);
        if (ratio > 0) extremum = -Math.log(ratio) / k;
      }
      if (extremum > 1e-12) h = Math.min(h, extremum);
      const initial = this.omega;
      let event: number | undefined;
      for (const boundary of motor ? [0, target] : [0]) {
        // Only an exact boundary is already resolved. Tiny nonzero velocities
        // still need their zero crossing before static friction can hold them.
        if (initial === boundary) continue;
        if ((initial - boundary) * (integrate(initial, a, b, k, h).omega - boundary) > 0) continue;
        let lo = 0,
          hi = h;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2,
            value = integrate(initial, a, b, k, mid).omega;
          if ((initial - boundary) * (value - boundary) > 0) lo = mid;
          else hi = mid;
        }
        if (hi <= h) {
          h = hi;
          event = boundary;
        }
      }
      const result = integrate(initial, a, b, k, h);
      this.angle += result.angle;
      this.omega = event ?? result.omega;
      this.dissipatedEnergy += Math.max(
        0,
        drive * result.angle - (c.inertia * (this.omega ** 2 - initial ** 2)) / 2,
      );
      if (this.stopping && this.omega === 0) this.stopping = false;
      local += h;
      remaining = Math.max(0, remaining - h);
    }
  }
}
