# Real joint motion implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Run the supplied STEP assembly in UE5 with measured geometry bindings, rolling bearings and dissipative brake dynamics, retaining explicit uncertainty.

**Architecture:** Keep the source CAD immutable. Add a `cad-joint` mechanism variant with source mesh bindings and optional independently labelled illustrative gear geometry. A renderer-independent SI solver and a matching native solver advance transient motion; SceneSpec contains only validated configuration.

**Tech Stack:** Node24/npm, TypeScript/Three.js/glTF-Transform, OCCT, UE5.8 C++/glTFRuntime.

**Spec:** `docs/superpowers/specs/2026-10-24-real-joint-motion-design.md` (user approved 2026-10-24).

## Global Constraints

- SceneSpec is the only serialized source of truth; use validated atomic SceneCommands.
- Metres, Y-up, radians, stable IDs; retain original CAD geometry and source hash.
- Unknown parts remain static; no default H100 tooth counts or dimensional scaling.
- Assumed parameters remain explicitly unconfirmed, never vendor performance claims.
- JS and C++ consume the same configuration and match deterministic scenarios.
- Pause/suspend freezes simulation; slow motion scales the simulation clock, not physical parameters.
- User CAD and generated binaries stay local and ignored by Git.

## Review Focus

- Duplicate/empty mesh names: bind by final serialized mesh index/path and reject stale source hashes.
- Brake power toggles mid-transition: preserve angle/velocity, restart finite transitions and never auto-start.
- Reverse/zero speed: bounded drive acceleration and dissipative friction without numerical reversal.
- Failed/partial binding: reject invalid paths; preserve unknown parts and prior scene on import failure.
- Large time partitions and suspension: consume elapsed active time, with consistent stop angle and no catch-up.

### Task 1: Typed configuration and deterministic motion core

**Files:** create `packages/scene-schema/src/cad-mechanism.ts`, `packages/engine/src/joint-dynamics.ts`, `tests/engine/joint-dynamics.test.ts`; modify schema.ts, commands.ts, engine package exports.

**Interfaces:** `CadMechanismSchema` defines kind `cad-joint`, shared subsystem/dimension/presentation fields, modelNodeId/sourceSha256/bindings/gear evidence, dynamics preset. `JointDynamics` exposes start/stop/setRpm/setPowered/setInstalled/tick/reset/snapshot; `rollingState(innerAngle,outerAngle,pitchRadius,ballRadius)` returns cage and world ball angles. Snapshot SI fields angle/omega/time/energy/closure/brakePhase.

- [x] Write tests for radial contact velocities (<1e-10), both ring directions; zero/bad radii rejected.
- [x] Write brake tests: power-off delay preserves speed, positive dissipated energy, no reversal, zero-load holding (external-load threshold remains unvalidated), release interlock/no auto-start, mid-transition toggles, reverse ramp, pause/slow motion; 5/10/20/60 FPS angle and omega within 1e-6.
- [x] Run targeted tests and observe missing implementation failure.
- [x] Implement an event-aware analytic integrator: piecewise linear brake closure, constant bounded drive torque, Coulomb brake plus viscous drag; split on transition boundaries/zero/target speed. Use exact integrals or small absolute simulation-time grid with interpolation and documented tolerance if needed.
- [x] Validate finite positive J/torque, nonnegative delay/ramp/drag; no human-confirmation fields set by AI. Add configureScene support for mechanism atomically; retain legacy harmonic compatibility.
- [x] Run targeted tests and check. Commit tested core.

### Task 2: Actual CAD bindings and independently labelled inspection layer

**Files:** create `generators/scene-builder/src/real-joint.ts`, `tests/assets/real-joint.test.ts`; local ignored analysis/install scripts and generated derivative only.

**Interfaces:** `prepareRealJoint(scene, finalGlbBytes, bindings): {scene, commands, report}` uses final serialized node paths and fits circular bearing centres/radii from original vertices. Bindings carry mesh index, role, axis/pivot and original transform; unknown entries static. Export public builder entry point.

- [x] Inventory final GLB nodes and STEP solids; identify shaft, races, balls, brake surfaces from names plus bounds/geometry; record confidence and actual tooth detail.
- [x] Write fixture test preserving world positions at zero, duplicate names, original byte hash and source dimension; out-of-range binding rejects atomically.
- [x] Run test RED, implement binding validation/derivation with SceneCommands, then GREEN.
- [x] For absent tooth detail create a separate optional labelled principle layer using an explicitly hypothetical two-tooth-difference pair; never move unverified actual output or pretend this is measured transmission. Dense phase sampling reports gaps/penetration for the illustrative profile only.
- [x] Publish local binding evidence and default scene; original CAD remains separate. Commit code and text evidence only.

### Task 3: Web and UE5 mechanical application

**Files:** modify `packages/engine/src/{mechanism.ts,runtime.ts}`, native `VirtualWorld{Mechanism,HUD,Story,Runtime,RuntimeTests,Model}.{cpp,h}` as applicable; create native `VirtualWorldJointDynamics.h`.

**Interfaces:** cad-joint guards preserve legacy harmonic branch. Both runtime paths apply original geometry about fitted pivots, cage orbit plus world ball spin, armature closure. Native binding records cache actual components by glTF node identity; no name-only lookup. HUD reports actual speed/phase/energy/assumptions, slow motion and marker/inspection controls.

- [x] Add native tests for shared deterministic scenario and source-transform commuting; prove RED before solver/application changes.
- [x] Apply core solver in JS and equivalent C++ equations with same preset; wire play/stop/power/pause/reset/speed and slow motion.
- [x] Verify ball position and orientation on actual components at multiple phases; material markers optional and reversible; original materials restored.
- [x] Compile native editor with project Xcode/UE paths; run automation for delays, reverse, stop angle, no auto-start and FPS consistency; update legacy tests only where intentionally changed.
- [x] Run targeted browser/controller tests then commit.

### Task 4: Full regression and native evidence

**Files:** `docs/validation-native-engines.md`, approved spec/plan checkboxes; ignored `output/playwright/real-joint-2026-10-24/` reports/captures.

- [x] Run npm test/check/build/format:check/test:browser/audit (Node24); report actual output and pre-existing warnings accurately.
- [x] Restart UE with real default; capture assembled/internal/rolling and brake delay/slip/hold/release views, read back actual transforms and solver state; keep the app open for user.
- [x] Compare JS/C++ JSON scenario values and original CAD bounds/hash; record tolerances and limitations.
- [x] Request fresh full-branch review, fix important findings with regression tests, rerun affected checks. Commit verified code, design and validation docs; no CAD binary.

## Completion evidence and qualification

Implemented and independently reviewed; final software suite 444 passed and UE automation 11 passed, with executed checks and limitations in `docs/validation-native-engines.md`. Original STEP and derived GLB hashes/units remain unchanged. Native C-key inspection was exercised in the ordinary window; per-button OS mouse verification is qualified because the UI tool did not update UE's pointer position. No external-load holding threshold, actual tooth-contact or hardware performance claim is made.
