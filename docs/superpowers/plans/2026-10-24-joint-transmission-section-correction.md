# Real joint transmission and section correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkboxes for tracking.

**Goal:** Correct the actual UE5 animation after user feedback: useful longitudinal inspection without floating bolts, and a complete real-geometry transmission at the user's stated 101 reduction.

**Architecture:** Retain the approved immutable-CAD/geometry-constraint architecture. Add an explicitly user-specified ratio with an explicitly identified fixed member, keeping inferred topology distinct from measured teeth. Derive optional inspection cuts from immutable real meshes; inspection never changes mechanical role or source bytes. Use the same transmission factors in browser/native animation.

**Tech Stack:** Node24/npm, TypeScript/Three.js, UE5.8 C++/glTFRuntime/ProceduralMeshComponent.

**Spec:** Existing approved `docs/superpowers/specs/2026-10-24-real-joint-motion-design.md`, corrected by the user's current request for 101 and a clearer section. This is a corrective extension of that authorization; no new calibration or hardware simulation claim.

## Evidence and decisions

- Current local profile deliberately has unresolved gearing and 0 output bindings. It therefore cannot verify a full transmission, despite prior solver/component tests passing.
- Current section only hides selected solids; bolts and most nested reducer geometry remain. No cutting plane or section camera is selected.
- Final GLB inventory plus actual longitudinal intersections/isolated component renders locate motor rotor mesh257, stator258, input hub2, wave hub58/inner ring33, flexspline hat31, output ring59, cross-bearing inner28, fixed outer29, output cover/hollow shaft129, output magnet carrier126 and encoder127/128. Roles are geometric inference, not a manufacturer BOM.
- The exact CAD name HS-17-II does not establish the catalogue variant: the supplied reducer bounds are 80mm x26.5mm, so generic catalogue dimensions cannot identify it blindly.
- General relation: Zf*(thetaF-thetaW)=Zc*(thetaC-thetaW). Flex fixed gives same-direction circular output (Zc-Zf)/Zc; circular fixed gives opposite-direction flex output -(Zc-Zf)/Zf. User ratio101 and CAD attachment suggest flex fixed/circular output. Keep this topology labelled geometric inference. Do not invent actual 200/202 teeth; those counts only illustrate a 101 topology in the separate principle layer.
- Original STEP/GLB geometry and hashes stay unchanged. Source private model and local preset remain ignored.

## Global constraints and review focus

- SceneSpec/atomic configureScene remain authoring truth, SI/Y-up/radians and stable final-node bindings.
- Ratio provenance is user-specified; dynamics remain demonstration-assumption. No automatic engineering confirmation.
- Preserve legacy evidenced fixed-ring configs and old sectionHidden configs.
- No rotating fixed housing or fixed flexspline. Rotor, wave hub and their attached inner rings follow input; output hardware follows output. Unknown roles remain static.
- Cut meshes are reversible derived display geometry, closed at cut faces where supported; full assembly restores original meshes. Avoid frame-dependent cuts or resource leaks.
- At101 the default6RPM output is only0.0594RPM; display actual input/output speed/angles and clear directional markers. Whole-clock fast inspection must keep the ratio correct, never speed output independently.
- Verify positive/reverse motion, brake stopping, explicit restart, zero phase, slow clock and 101input turns ->1output turn; user view must demonstrate output on real components.

### Task 1: Explicit transmission model and browser consistency

Files: scene-schema cad-mechanism.ts; engine joint-geometry.ts/mechanism.ts/cad-joint-view.ts; relevant tests and shared controls.

- [x] RED tests for a user-specified101 fixed-flex/circular-output configuration, old fixed-ring compatibility, correct primitive/ring phases and actual output speed.
- [x] Add strict user-specified gear variant and common transmission factors; support flexspline/circular-spline roles and inspectionCut flag.
- [x] Correct principle profile phases for both fixed-member modes, with hypothetical counts explicitly labelled.
- [x] GREEN targeted tests/check; inspection cuts may remain native-specific but web role/ratio/visibility semantics must stay valid.

### Task 2: Native section and complete motion

Files: native VirtualWorldCadJoint/Mechanism/HUD/Character/Runtime headers and tests.

- [x] RED native/config/portable tests for factors, output component poses, section reversibility and correct camera axis.
- [x] Apply reported transmission consistently in actual component motion and HUD. Add output markers/readings so slow reduction is inspectable.
- [x] Derive half-cut inspection meshes with caps for explicitly selected occluders, using original geometry and fixed model-frame plane. Hide local fasteners in inspection; choose longitudinal camera automatically on entering inspection.
- [x] Keep original full-assembly view and clean up all derived components. Add useful keyboard paths for inspection controls to enable window verification.
- [x] Compile and run actual native component/section tests.

### Task 3: Actual profile and native acceptance

Files: ignored actual CAD profile/install scripts and generated native project; validation docs.

- [x] Bind inferred actual input/output/fixed groups and relevant circular bearings, including rotor257 and output shaft129; retain unverified wave-bearing material deformation as simplified.
- [x] Record sourced mechanical relation and user101 separately from teeth evidence. Avoid false assurance about simplified vendor teeth.
- [x] Run full software tests/check/build/format and affected browser checks; native build/automation and actual window startup, motion, section and brake checks.
- [x] Review corrective diff; commit to existing PR branch and update PR19 with evidence/remaining limits. Do not merge unrelated main changes or upload private CAD.

## User follow-up: exterior-only bearings

The user explicitly removed bearing cutaways, internal structures and internal motion from the display scope. Retain original full bearing races and covers as static exterior display; omit balls/cages in all views and remove their animation bindings. This is a display simplification, not a claim that bearing races are stationary in the physical joint. Keep motor/wave/output motion at101 unchanged.

- [x] Add validated `binding.displayHidden` for omitted display internals; web and native honor it in assembly and section, with no cut/marker display.
- [x] Install local immutable-CAD profile with no rolling bearing bindings and no bearing cuts.
- [x] Re-run affected software and actual UE tests and view; record final evidence and update PR19.
