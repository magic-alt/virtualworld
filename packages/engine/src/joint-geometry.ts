import { Quaternion, Vector3 } from 'three';
import type { CadMechanism } from '@virtualworld/scene-schema';
import { rollingState } from './joint-dynamics';
type Binding = CadMechanism['bindings'][number];
type Bearing = CadMechanism['bearings'][number];
type Principle = NonNullable<CadMechanism['principle']>;
type Vec3 = [number, number, number];
const identity = () => ({
  translation: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0, 1] as [number, number, number, number],
});
/** Angular factors relative to the input; stated ratios never assert actual tooth counts. */
export function cadTransmission(gear: CadMechanism['gear'] | undefined) {
  let known = false,
    flex = 0,
    circular = 0;
  if (gear?.status === 'user-specified') {
    known = true;
    if (gear.fixedMember === 'flexspline') circular = 1 / gear.reductionRatio;
    else flex = -1 / gear.reductionRatio;
  } else if (gear?.status === 'evidenced') {
    known = true;
    flex = -(gear.ringTeeth - gear.flexTeeth) / gear.flexTeeth;
  }
  return { known, input: 1, flex, circular, output: circular || flex };
}
/** Delta in the original CAD frame; compose on the left of the authored model transform. */
export function cadBindingPose(
  binding: Binding,
  bearing: Bearing | undefined,
  angle: number,
  closure: number,
  travel: number,
  transmission: ReturnType<typeof cadTransmission> | number | undefined,
) {
  if (angle === 0 && closure === 0) return identity();
  const axis = new Vector3(...binding.axis),
    pivot = new Vector3(...binding.pivot);
  let rotation = new Quaternion(),
    translation = new Vector3();
  if (binding.role === 'ball') {
    if (!bearing || !binding.center) throw new Error('Ball requires fitted bearing and centre');
    const rolling = rollingState(
      angle * bearing.innerSpeedFactor,
      angle * bearing.outerSpeedFactor,
      bearing.pitchRadius,
      bearing.ballRadius,
    );
    const center = new Vector3(...binding.center),
      orbit = new Quaternion().setFromAxisAngle(axis, rolling.cageAngle);
    rotation.setFromAxisAngle(axis, rolling.worldBallAngle);
    translation
      .copy(center)
      .sub(pivot)
      .applyQuaternion(orbit)
      .add(pivot)
      .sub(center.clone().applyQuaternion(rotation));
  } else {
    let phase = 0;
    const factors =
      typeof transmission === 'number'
        ? { input: 1, flex: transmission, circular: 0, output: transmission }
        : transmission;
    if (binding.role === 'input') phase = angle * (factors?.input ?? 1);
    else if (binding.role === 'inner-race' && bearing) phase = angle * bearing.innerSpeedFactor;
    else if (binding.role === 'outer-race' && bearing) phase = angle * bearing.outerSpeedFactor;
    else if (binding.role === 'output') phase = angle * (factors?.output ?? 0);
    else if (binding.role === 'flexspline') phase = angle * (factors?.flex ?? 0);
    else if (binding.role === 'circular-spline') phase = angle * (factors?.circular ?? 0);
    rotation.setFromAxisAngle(axis, phase);
    translation.copy(pivot).sub(pivot.clone().applyQuaternion(rotation));
    if (binding.role === 'armature') translation.addScaledVector(axis, travel * closure);
  }
  return { translation: translation.toArray(), rotation: rotation.toArray() };
}
/** Separate illustrative profile. Material arclabel u has a tangential correction near both engagement zones. */
export function principlePoint(p: Principle, u: number, theta: number) {
  const difference = p.ringTeeth - p.flexTeeth,
    flexPhase = p.fixedMember === 'flexspline' ? 0 : (-difference / p.flexTeeth) * theta;
  let phi = u + flexPhase;
  for (let i = 0; i < 10; i++) {
    const delta = phi - theta;
    phi -=
      (phi - flexPhase + (difference / (2 * p.flexTeeth)) * Math.sin(2 * delta) - u) /
      (1 + (difference / p.flexTeeth) * Math.cos(2 * delta));
  }
  const radius =
    p.radius +
    p.amplitude * Math.cos(2 * (phi - theta)) +
    p.toothHeight * Math.cos(p.flexTeeth * u);
  return { phi, radius, x: radius * Math.cos(phi), y: radius * Math.sin(phi) };
}
export function principleRingRadius(p: Principle, phi: number, theta = 0) {
  const circularPhase =
    p.fixedMember === 'flexspline' ? ((p.ringTeeth - p.flexTeeth) / p.ringTeeth) * theta : 0;
  return (
    p.radius +
    p.amplitude +
    p.clearance +
    p.toothHeight * Math.cos(p.ringTeeth * (phi - circularPhase))
  );
}

/** Illustrative hollow cam contour, inside the flex strip even at a tooth root. Not vendor CAD. */
export function principleCamPoint(p: Principle, u: number, theta: number) {
  const phi = u + theta,
    radius =
      p.radius +
      p.amplitude * Math.cos(2 * u) -
      Math.max(0.0004, p.toothHeight * 3) -
      p.toothHeight -
      p.clearance;
  return { phi, radius, x: radius * Math.cos(phi), y: radius * Math.sin(phi) };
}
