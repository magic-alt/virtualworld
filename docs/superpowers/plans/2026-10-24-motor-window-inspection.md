# Motor window inspection correction

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkboxes for tracking.

**Goal:** Show the real motor turning through one local cutaway, without marker balls, bearing internals or a cut output circular spline.

**Architecture:** Preserve the final CAD bytes and mechanical bindings. Add optional CAD display settings `motionMarkers:false` and `inspectionCutaway:'quarter-window'`; legacy scenes retain their half-section/default marker behavior. Native derives a capped 270-degree retained display by joining a kept half and a non-overlapping kept quarter. Only explicitly selected motor housing/stator bodies are cut. Source geometry and full view restore unchanged.

**Tech stack:** Node24/npm, TypeScript/Three.js, UE5.8 C++/ProceduralMeshComponent.

**Spec:** The user's current explicit correction, together with the approved real-joint design and subsequent exterior-only bearing instruction. User supplied both101 and fixed-flex/circular-output topology; actual tooth counts and brake dynamics remain unmeasured.

## Constraints and decisions

- Reuse `codex/ue5-lighting-step-import` and the existing native project. Keep private CAD and local presets ignored.
- SceneSpec/validated atomic configureScene remains authoring truth. SI, stable final GLB identities, source hashes unchanged.
- A front-facing90-degree sector is an implementation choice for "一个角度剖面"; the user requested implementation, so continue without repeating prior design approval.
- Cut only housing mesh0 and stator258. Keep rotor257, shaft2, wave generator58, fixed flex31, circular spline59 and output129 complete.
- Bearings retain whole static exterior display, no internal balls/cages or internal animation. No motion marker components or M button in this local profile.
- Mark the fixed member as user-specified rather than inferred; do not mark unmeasured engineering parameters confirmed.
- Native caps are supported-loop display triangulation, not a CAD Boolean or a contact simulation. Browser inspection remains explicitly qualified occluder hiding.

## Review focus

- Hidden source bodies or model/ancestor hiding must suppress derived sections; resource cleanup and full-view restoration must remain correct.
- A90-degree removal retains three quadrants, not one; transformed/nonuniform model roots must preserve the model-frame cut.
- No marker balls may appear after M, section, restart or brake toggles when markers are disabled.
- Complete output circular spline still obeys+1/101 while rotor/shaft/wave input remain synchronous and flex stays fixed.
- An axisymmetric rotor can look stationary: use actual CAD surface details and actual angle readback, never an invented speed or detached sphere.

### Task1: Declarative display policy and native quarter cut

- [x] Write/run RED web policy/schema tests and native quarter geometry/marker-policy regressions.
- [x] Add optional settings and fixed-member provenance; honor markers in web/native and their controls/status.
- [x] Implement capped kept-half plus kept-quarter display, diagonal camera, disposal and pose reuse.
- [x] GREEN focused tests, native build and regressions.

### Task2: Actual model and acceptance

- [x] Install validated private profile: cuts0/258 only; no markers; uncut bearings/reducer; user-specified fixed member. Verify immutable source and final GLB hashes.
- [x] Full software/check/build/format, affected CAD browser and actual native automation; ordinary UE window inspection/motion/brake verification.
- [x] Fresh final review, resolve important findings, record evidence and limitations, commit/push to existing PR19.

### Task3: User-specified default1000RPM

User explicitly requests1000RPM default; persist as SceneSpec.mechanism.defaultRpm, initialize and reset both solver/setpoint from it, keep clock1x and101output. Preserve legacy6 when absent; extend CAD presentation speed controls consistently to twice the configured default (minimum30, numerical maximum100000), not a claimed rated capability.

- [x] Web/default schema RED→GREEN, native reset/freshload/limits RED.
- [x] GREEN native build/fullautomation and ordinary window1000RPM/9.90099RPM, reset/reopen.
- [x] Record final evidence and independent review; commit/push to existing PR19.
