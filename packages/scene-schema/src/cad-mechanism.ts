import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const torque = z.number().finite().min(1e-9).max(1e6);
const duration = z
  .number()
  .finite()
  .min(0)
  .max(60)
  .refine((v) => v === 0 || v >= 1e-9, 'Nonzero transition time must be at least one nanosecond');
export const MechanismCommonShape = {
  subsystems: z
    .array(
      z
        .object({
          id,
          name: z.string().min(1).max(100),
          description: z.string().min(1).max(2000),
          nodeIds: z.array(id).min(1),
          optional: z.literal('brake').optional(),
        })
        .strict(),
    )
    .optional(),
  referenceNotes: z.string().max(6000).optional(),
  fixedNodeIds: z.array(id),
  fullHousingIds: z.array(id),
  sectionHousingIds: z.array(id),
  dimensions: z
    .object({
      baseDiameter: positive,
      housingDiameter: positive,
      totalHeight: positive,
      boreDiameter: positive,
    })
    .strict(),
};

/** SI demonstration assumptions, never measured or human-confirmed parameters. */
export const JointDynamicsSchema = z
  .object({
    inertia: z.number().finite().min(1e-9).max(1e3),
    driveTorque: torque,
    brakeTorque: torque,
    holdTorque: torque,
    viscousDrag: nonnegative.max(1e6),
    engageDelay: duration,
    engageRamp: duration,
    releaseDelay: duration,
    releaseRamp: duration,
    armatureTravel: nonnegative.max(0.01),
    provenance: z.literal('demonstration-assumption'),
    notes: z.string().min(1).max(2000),
  })
  .strict()
  .refine(
    (v) => v.holdTorque >= v.brakeTorque,
    'Static hold torque must cover sliding brake torque',
  );
export type JointDynamicsConfig = z.infer<typeof JointDynamicsSchema>;

const BearingSchema = z
  .object({
    id,
    innerSpeedFactor: z.number().finite().min(-1000).max(1000),
    outerSpeedFactor: z.number().finite().min(-1000).max(1000),
    pitchRadius: positive,
    ballRadius: positive,
  })
  .strict()
  .refine((v) => v.ballRadius < v.pitchRadius, 'Ball radius must be smaller than pitch radius');
const BindingSchema = z
  .object({
    gltfNodeIndex: z.number().int().nonnegative(),
    originalPath: z.string().min(1).max(4000),
    role: z.enum([
      'input',
      'output',
      'flexspline',
      'circular-spline',
      'ball',
      'inner-race',
      'outer-race',
      'armature',
      'fixed',
      'unknown',
    ]),
    /** Pivot and axis in original CAD frame, with lengths converted once to metres. */
    pivot: vector,
    axis: vector.refine((v) => Math.abs(Math.hypot(...v) - 1) < 1e-6, 'Axis must be unit length'),
    bearingId: id.optional(),
    center: vector.optional(),
    inspectionHidden: z.boolean().optional(),
    inspectionCut: z.boolean().optional(),
    /** Omit display details in every view without changing the retained source CAD. */
    displayHidden: z.boolean().optional(),
    group: z.string().min(1).max(200).optional(),
    phase: z.number().finite().optional(),
  })
  .strict();
const GearSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unresolved'), notes: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      status: z.literal('user-specified'),
      reductionRatio: positive,
      fixedMember: z.enum(['flexspline', 'circular-spline']),
      fixedMemberProvenance: z.enum(['user-specified', 'geometric-inference']).optional(),
      evidence: z.string().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      status: z.literal('evidenced'),
      flexTeeth: z.number().int().positive(),
      ringTeeth: z.number().int().positive(),
      fixedRing: z.literal(true),
      evidence: z.string().min(1).max(4000),
    })
    .strict(),
]);
export const CadMechanismObjectSchema = z
  .object({
    ...MechanismCommonShape,
    kind: z.literal('cad-joint'),
    modelNodeId: id,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    modelSha256: z.string().regex(/^[a-f0-9]{64}$/),
    motionMarkers: z.boolean().optional(),
    /** Final GLB node identities; attachment identification remains geometric inference. */
    driveChain: z
      .object({
        rotor: z.number().int().nonnegative(),
        shaft: z.number().int().nonnegative(),
        waveGenerator: z.number().int().nonnegative(),
        flexspline: z.number().int().nonnegative(),
        circularSpline: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    defaultRpm: z.number().finite().min(-100000).max(100000).optional(),
    inspectionCutaway: z.enum(['half', 'quarter-window']).optional(),
    principle: z
      .object({
        kind: z.literal('illustrative-harmonic'),
        flexTeeth: z.number().int().min(10),
        ringTeeth: z.number().int().min(10),
        fixedMember: z.enum(['flexspline', 'circular-spline']).optional(),
        radius: positive,
        amplitude: positive,
        toothHeight: positive,
        clearance: nonnegative,
        position: vector,
        label: z.string().min(1).max(1000),
      })
      .strict()
      .refine(
        (v) =>
          v.ringTeeth === v.flexTeeth + 2 &&
          v.amplitude < v.radius / 4 &&
          v.toothHeight < v.amplitude / 2,
        'Illustrative two-wave gear requires two extra ring teeth and bounded deformation',
      )
      .optional(),
    bindings: z.array(BindingSchema).max(5000),
    bearings: z.array(BearingSchema).max(100),
    gear: GearSchema,
    dynamics: JointDynamicsSchema,
  })
  .strict();
export function validateCadMechanism(
  value: z.infer<typeof CadMechanismObjectSchema>,
  ctx: z.RefinementCtx,
) {
  const indices = new Set<number>(),
    bearings = new Set<string>();
  for (const bearing of value.bearings) {
    if (bearings.has(bearing.id))
      ctx.addIssue({ code: 'custom', message: `Duplicate bearing: ${bearing.id}` });
    bearings.add(bearing.id);
  }
  for (const binding of value.bindings) {
    if (indices.has(binding.gltfNodeIndex))
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate glTF node binding: ${binding.gltfNodeIndex}`,
      });
    indices.add(binding.gltfNodeIndex);
    if (binding.bearingId && !bearings.has(binding.bearingId))
      ctx.addIssue({ code: 'custom', message: `Missing bearing: ${binding.bearingId}` });
    if (['ball', 'inner-race', 'outer-race'].includes(binding.role) && !binding.bearingId)
      ctx.addIssue({ code: 'custom', message: 'Bearing roles require a bearingId' });
  }
  if (value.driveChain) {
    const chain = value.driveChain;
    const stages = [
      'rotor',
      'shaft',
      'waveGenerator',
      'flexspline',
      'circularSpline',
      'output',
    ] as const;
    const roles = ['input', 'input', 'input', 'flexspline', 'circular-spline', 'output'];
    const byIndex = new Map(value.bindings.map((b) => [b.gltfNodeIndex, b]));
    const reference = byIndex.get(chain.rotor);
    if (new Set(Object.values(chain)).size !== stages.length || value.gear.status === 'unresolved')
      ctx.addIssue({
        code: 'custom',
        message: 'Drive chain requires six distinct nodes and a resolved transmission',
      });
    for (let i = 0; i < stages.length; i++) {
      const b = byIndex.get(chain[stages[i]]);
      if (!b || b.role !== roles[i]) {
        ctx.addIssue({
          code: 'custom',
          message: `Drive chain ${stages[i]} requires a bound ${roles[i]} node`,
        });
        continue;
      }
      if (reference) {
        const alignment = b.axis.reduce((sum, v, j) => sum + v * reference.axis[j], 0);
        const d = b.pivot.map((v, j) => v - reference.pivot[j]);
        const cross = [
          d[1] * reference.axis[2] - d[2] * reference.axis[1],
          d[2] * reference.axis[0] - d[0] * reference.axis[2],
          d[0] * reference.axis[1] - d[1] * reference.axis[0],
        ];
        if (alignment < 1 - 1e-8 || Math.hypot(...cross) > 1e-6)
          ctx.addIssue({
            code: 'custom',
            message: `Drive chain ${stages[i]} must share the directed rotor axis`,
          });
      }
    }
  }
  if (value.gear.status === 'evidenced' && value.gear.ringTeeth <= value.gear.flexTeeth)
    ctx.addIssue({ code: 'custom', message: 'Ring teeth must exceed flex teeth' });
}
export const CadMechanismSchema = CadMechanismObjectSchema.superRefine(validateCadMechanism);
export type CadMechanism = z.infer<typeof CadMechanismSchema>;
export const HarmonicMechanismSchema = z
  .object({
    ...MechanismCommonShape,
    kind: z.literal('harmonic'),
    waveNodeId: id,
    flexNodeId: id,
    outputNodeId: id,
    flexTeeth: z.number().int().min(10),
    ringTeeth: z.number().int().min(10),
    cosMorph: z.string().min(1),
    sinMorph: z.string().min(1),
  })
  .strict();
export const MechanismSchema = z
  .discriminatedUnion('kind', [HarmonicMechanismSchema, CadMechanismObjectSchema])
  .superRefine((value, ctx) => {
    if (value.kind === 'cad-joint') validateCadMechanism(value, ctx);
  });
export type Mechanism = z.infer<typeof MechanismSchema>;
