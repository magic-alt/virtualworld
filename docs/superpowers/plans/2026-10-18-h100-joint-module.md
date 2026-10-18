# H-100 Joint Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved compact H-100 model and consistent web/offline controls.

**Architecture:** SceneSpec owns descriptive assembly metadata; a runtime mechanism controller owns transient motion and observation state. Fixed Blender source generates individually addressable meshes and measured manifests; the browser and standalone player mount the same control component.

**Tech Stack:** Node.js 24, npm, TypeScript, Three.js, React, Blender Python, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-h100-joint-module-design.md`

## Global Constraints

- SI metres, Y-up, radians, stable project and movement-group IDs; SceneSpec remains the serialized source of truth.
- H-100 illustrative envelope: base 0.110 m, housing 0.100 m, height 0.110 m, bore 0.018 m; 200/202 teeth, negative 100:1 transmission.
- Original reconstructed internals, explicit official references; no committed vendor CAD binaries, no rated-performance claims.
- Node.js 24 and npm; use public workspace entry points. No runtime imports from generators or applications.
- Transient viewing and motion never mutate SceneSpec; persistent AI edits retain validated atomic commands and project-generation fencing.
- Initial assets under 15 MiB; export works without editor services or external network.

## Review Focus

- Invalid/non-finite speeds and repeated toggles must not corrupt motion; Task 2 pins clamps and brake transitions.
- Hidden/section/optional meshes must compose without duplicate shells or invisible parents; Tasks 1 and 3 pin valid references and visibility.
- Narrow/tall viewports must show the exploded assembly above controls; Tasks 3 and 5 exercise fit and mobile bounds.
- Recreated projects must discard subscriptions, phase and panel state; Tasks 2, 4 and 5 exercise cleanup and re-entry.
- Legacy scenes without new metadata and offline exports must remain usable; Tasks 1, 4 and 5 test both.

## File Responsibilities

- `packages/scene-schema/src/schema.ts`: optional descriptive subsystem metadata and `assertScene` reference validation.
- `packages/engine/src/mechanism.ts`: harmonic kinematics and renderer-independent transient controller.
- `packages/engine/src/runtime.ts`: apply controller state to meshes, visibility, fitted camera and diagnostics.
- `generators/blender/harmonic/{recipe.json,build.py,finalize.mjs,README.md}`: geometry, final paths, metadata and provenance.
- `apps/web/shared/mechanism-controls.ts`: one DOM panel for web/player, state subscription and cleanup.
- `apps/web/src/{WorldExperience.tsx,world.css}`, `apps/web/player/main.ts`: mounting and responsive presentation.
- `tests/engine/{mechanism,showcase-schema}.test.ts`, `tests/assets/harmonic.test.ts`: behavioral and serialized-geometry checks.
- `tests/e2e/harmonic-controls-check.mjs`: full desktop/mobile and offline control acceptance.

### Task 1: Validated descriptive assembly metadata

**Interfaces:** Extend optional `SceneSpec.mechanism` metadata with `subsystems: {id,name,description,nodeIds,optional?:'brake'}[]` and `referenceNotes?: string`. Keep all old fields and old worlds valid. Each node belongs to at most one subsystem; referenced nodes and subsystem IDs must exist/be unique.

- [ ] Add failing tests to `tests/engine/showcase-schema.test.ts`: valid metadata passes; missing node, repeated subsystem ID and repeated membership throw; metadata-free legacy mechanism passes.
- [ ] Run `npx vitest run tests/engine/showcase-schema.test.ts` and inspect expected assertion failures.
- [ ] Implement strict optional fields and semantic validation in `schema.ts` / `assertScene`; retain moving/fixed ancestry checks.
- [ ] Rerun the focused tests and `npm run check`; commit the schema increment.

### Task 2: Transient mechanism controller and runtime state

**Interfaces:** Export `MechanismController` from `mechanism.ts`; constructor accepts `{flexTeeth:number,ringTeeth:number,hasBrake:boolean}`. `snapshot(): MechanismState` returns harmonic-state values plus `{moving:boolean,paused:boolean,actualInputRpm:number,actualOutputRpm:number,brakeInstalled:boolean,brakePowered:boolean}`. `subscribe(listener:(state:MechanismState)=>void):()=>void` immediately delivers the current state. Mutating operations return `void`: `setMoving(enabled:boolean)`, `setSpeed(rpm:number)`, `step(radians:number)`, `resetMotion()`, `setBrakeInstalled(installed:boolean)`, `setBrakePowered(powered:boolean)`, `tick(dt:number,paused:boolean)`, `dispose()`. Runtime exposes corresponding actions, `getMechanismState(): MechanismState | undefined` and `subscribeMechanism(listener):()=>void` through its public entry point; presentation state remains owned by runtime and emits through the same subscription.

- [ ] Add controller tests: pause retains angle; 2π input produces -2π/100 output; initial speed 6; clamp ±30; NaN ignored; ±π/12 step only while stopped; engaged brake blocks tick; power restore and installation changes pause; unsubscribe/dispose prevents notifications.
- [ ] Run focused test red, implement state, rerun green.
- [ ] Connect runtime frame, load/reset/dispose and diagnostics; preserve legacy non-harmonic joint animation. Expose commanded and actual RPM separately and keep fixed transforms stable.
- [ ] Run `npx vitest run tests/engine/mechanism.test.ts` and `npm run check`; commit.

### Task 3: Compact parametric assembly and observation

**Interfaces:** Recipe defines dimensions, clearances, axial zones and named contact pairs. Finalizer emits the existing world ID, independent movement groups, measured asset paths and subsystem metadata. Runtime adds `setSubsystemVisible(id,visible)`, `isolateSubsystem(id?)`, `fitMechanismView(view?:'default'|'front'|'side'|'top')`, `resetMechanismPresentation()`.

- [ ] Update asset assertions to the approved dimensions; add requirements for drive power stage, two encoders, brake fixed/input pieces, continuous hollow bore and subsystem references; run red against old GLB.
- [ ] Rebuild source geometry from consistent layer datums: rear drive, brake, frameless motor, hollow input supports, cup reducer, output support/flange. Preserve illustrative tooth counts/morph phase and real mounting holes; add capped section variants.
- [ ] Record manufacturer URLs, downloaded reference hash, confirmed envelope and reconstruction assumptions in README/manifest; keep source and optimized paths distinct.
- [ ] Implement transient subsystem visibility, section composition and fitted camera using visible world bounds, viewport aspect and reserved UI margins. Clamp explosion 0..1; restore defaults without overwriting quality or SceneSpec.
- [ ] Run `npm run demos:build -- harmonic`, inspect actual geometry/overlap results, then `npm run demos:validate` and asset/runtime tests. Resolve unexpected intersections rather than blanket-whitelisting assemblies; commit generated assets with source.

### Task 4: Shared controls and page integration

**Interfaces:** `mountMechanismControls(runtime): {element:HTMLElement,dispose():void}` in `apps/web/shared/mechanism-controls.ts`. React and player dispose before runtime/project replacement. All controls derive values from runtime state; no second moving flag.

- [ ] Create browser assertions for play/pause/zero/step/speed, ratio/readouts, brake interlock, section/explode, subsystem show/isolate/reset and camera controls; run against old UI to establish failure.
- [ ] Implement accessible Chinese panel, collapsible mobile layout, status/readouts, numeric/range synchronization and explicit brake limitations. Do not rebuild inputs on every motion tick or steal active keyboard focus.
- [ ] Replace duplicate web/player controls with the shared panel; retain non-mechanism fallback and existing experience controls. Dispose event/subscription resources on re-entry.
- [ ] Verify settings/global pause phase, quality, fullscreen results, AI preview/apply/undo/save, dirty navigation, export and advanced editor project identity. Fix scoped defects exposed by these checks.
- [ ] Run type check and focused browser acceptance; commit.

### Task 5: Acceptance, offline delivery and evidence

**Interfaces:** `tests/e2e/harmonic-controls-check.mjs` uses installed Playwright with the established browser executable fallback, writes ignored evidence under `output/playwright/h100/`, fails on incorrect state or console errors and exercises an exported static player with editor/external requests blocked.

- [ ] Exercise every visible control at desktop and 390×844 mobile, including keyboard access, all-hidden subsystem recovery, disabled storage, settings/Esc pause composition, scene exit/re-entry and brake/global pause combinations.
- [ ] Capture and visually review assembled, sectioned, exploded and isolated geometry; check current visible model remains within the canvas safe area.
- [ ] Run `npm test`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run test:showcases`, `npm run format:check`, `npm audit`, plus the new harmonic browser check. Record exact outcomes, asset size and observed metrics.
- [ ] Review the complete branch with a fresh reviewer, address material findings and rerun affected checks. Update design status and delivery documentation; commit verified changes.

## Execution Record

The user explicitly requested implementation of the approved detailed design on 2026-10-18. This plan is the concrete implementation handoff for review. Recommend executing in the current session on `feat/h100-joint-module`, with one independent whole-branch review at the end: the schema, runtime, generator and panel have closely coupled interfaces. Track actual results and deviations separately from planned expectations. Do not report planned checks as passing.

Pre-implementation baseline, executed on 2026-10-18 at design commit `124ddb8`:

- Node.js `v24.14.1`.
- `npm test`: 28 test files / 107 tests passed, including fixture preparation.
- `npm run check`: passed (`tsc --noEmit`).
- Prettier check for this plan and its spec: passed.
- No model rebuild, product implementation or new-feature acceptance has been performed at this handoff.
