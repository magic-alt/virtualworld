# Explicit joint drive chain implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkboxes for tracking.

**Goal:** Make the approved rotor → shaft → wave generator → fixed flex / circular output → flange chain explicit and verifiable in UE.

**Architecture:** Optional SceneSpec driveChain names six final GLB identities. Validate roles, unique identities and a common directed axis before authoring or native motion. Existing CAD rigid transforms remain authoritative. Add a hollow two-lobe cam to the separate labelled principle layer, driven by the same input angle; do not deform vendor CAD or show bearing internals.

**Tech Stack:** Node24, Zod/Three.js, UE5.8 C++ procedural meshes.

**Spec:** User's explicit 2026-10-24 approval of the quoted chain, `docs/superpowers/specs/2026-10-24-real-joint-motion-design.md`, with later fixed-flex/101, exterior-only bearings, marker-free motor window and1000RPM instructions taking precedence.

## Global constraints

- Reuse existing PR19 branch and current checkout/native project. No private CAD or generated files committed.
- Default1000RPM, real clock1x, circular output+1/101. Unknown bodies remain static.
- Original mesh0/258 only motor-window cuts; bearings and circular output complete. No reference balls.
- Chain attachment identities remain geometric inference. Actual teeth/elasticity/brake constants remain unmeasured.
- Cam is a labelled illustrative two-wave profile with central bore and clearance, not the actual bearing or vendor geometry.

## Review focus

- Reject missing/duplicate references, wrong moving roles and reversed or offset axes; axial pivot offsets are valid.
- Legacy scenes without chain still work; chain validation must happen before runtime reparenting.
- Cam and gear rotate with same signed input, survive long-angle/reverse phases; no accumulated geometry deformation.
- Cam remains inside flex strip and leaves a central bore; cleanup and hidden principle layer include cam.
- Native validation mirrors serialized schema and verifies final real component roles rather than using mesh-number assumptions.

### Task1: Explicit chain and coherent principle cam

**Files:** schema/cad-mechanism.ts; engine/cad-joint-view.ts and joint-geometry.ts; native VirtualWorldCadJoint.cpp/Tests.cpp; corresponding engine tests. The ignored actual-profile installer supplies six final node identities from its final GLB inventory.

**Interfaces:** `CadMechanism.driveChain` holds rotor/shaft/waveGenerator/flexspline/circularSpline/output node indices. Schema validation ensures six distinct bound nodes with correct roles and coaxial directed axes within1µm. `principleCamPoint(p,u,theta)` returns radius/phi/x/y in the illustrative layer; native section2 is the equivalent hollow cam.

- [x] Add tests rejecting bad chain references/roles/axes and accepting axial pivot displacement; test same-solver signed component transforms and cam clearance/bore/restore/dispose. Observe RED.
- [x] Implement minimal schema/native validation and cam geometry; preserve CAD transforms and legacy configs. Observe GREEN.
- [x] Install immutable local profile through validated atomic configureScene. Run full software/check/build/format and affected browser fixture; compile native and run full CadJoint tests.
- [x] Verify ordinary UE1000RPM window and principle cam, restore motor window; independent review, record executed evidence, commit/push PR19.
