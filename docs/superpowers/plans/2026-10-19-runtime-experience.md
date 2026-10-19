# Runtime and Experience Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the independently owned tasks below. Steps use checkbox syntax for tracking.

**Goal:** Improve startup, Little Prince playability and H-100 inspection while preserving all model assets.

**Architecture:** Keep the shared SceneSpec/runtime. Add shared interaction-state semantics and shared presentation UI, with isolated loading and serving improvements. Runtime integration follows the independently owned UI and helper changes.

**Tech Stack:** Node.js 24, TypeScript, React 19, Three.js 0.180, Vite, Fastify, Rapier, Vitest, Playwright.

**Spec:** [runtime-experience-design.md](../../runtime-experience-design.md)

## Global Constraints

- Preserve all GLB/source models, mesh recipes, engineering dimensions and pinned dependencies.
- Keep metres, Y-up, radians and stable scene IDs.
- Presentation controls must not mutate serialized SceneSpec; story progress remains separate.
- Runtime packages never import applications, generators or Node-only processing.
- Preserve offline export and use the same shared controls in application and player.
- Work on `fix/runtime-prince-joint-experience`; only the coordinator commits and publishes.

## Review Focus

- Available and completed hotspots overlap: E must pick the available task, explicit clicks may replay history.
- Camera looks vertically at a plane: movement remains finite and normalized.
- Optional brake is removed while selected/isolated: remaining assembly stays observable.
- A mutable asset changes at the same URL: old validators do not hide its new content.
- A lazy renderer fails or the component unmounts before initialization: poster/error state remains useful and resources are not leaked.

### Task 1: Shared story affordances and chapter consistency

**Files:** `packages/interaction/src/story.ts`, `character.ts`; `apps/web/shared/experience-controls.ts`, `experience.css`; `apps/web/src/WorldExperience.tsx`; `worlds/little-prince/chapters/b612/scene.json`; scene-only `generators/blender/prince/bundles.mjs`; relevant new/updated tests.

**Interfaces:** Export `interactionStatus(node: SceneNode, state: StoryState): 'none' | 'locked' | 'available' | 'completed'` from the existing interaction public entry. The shared UI consumes current `RuntimeMetrics.hotspots` and story state. Runtime `nearest()` integration belongs to Task 4.

- [x] Add failing behavioral tests for interaction status and camera-relative planar movement (+X camera forward moves W along +X).
- [x] Implement the helper and normalized ground-tangent movement using existing spherical basis utilities.
- [x] Add shared accessible hotspot buttons and nearby interaction guidance without bypassing runtime range checks; expose locked/completed states.
- [x] Move the sunset anchor beside the asset's chair and verify its proximity using real GLB data, without regenerating models.
- [x] Show next-chapter actions only when one exists; the final chapter reports campaign completion.
- [x] Run focused tests and add browser coverage using visible interaction controls. Document the exact checks run.

### Task 2: Mechanism presentation and shared controls

**Files:** `packages/engine/src/runtime.ts` (mechanism, selection and camera blocks only); `apps/web/shared/mechanism-controls.ts`, `mechanism.css`; `apps/web/src/StudioApp.tsx`; relevant mechanism unit/browser tests.

**Interfaces:** Keep named `fitMechanismView(view)` behavior; no-argument fitting preserves the current viewing direction. Add transient subsystem selection/focus to `MechanismViewState` and public runtime methods, with shared subscription-driven UI. Coordinate exact method names before consumers are added. Task 4 edits the runtime only after this task releases it.

- [x] Add failing tests for user-orbit direction after no-argument reframing and unavailable brake isolation/removal.
- [x] Implement direction-preserving framing and optional-subsystem guards without model or SceneSpec edits.
- [x] Implement visible-mesh subsystem picking, selection description, safe-area focus and isolation controls.
- [x] Reuse shared mechanism controls in the advanced editor and remove competing mechanism-specific React state.
- [x] Improve narrow-screen readouts/controls and add focused desktop/mobile/player regressions.
- [x] Run focused tests and report runtime ownership released for Task 4.

### Task 3: Loading boundaries and static asset delivery

**Files:** `apps/web/src/App.tsx`, a focused lazy preview component, related CSS; `apps/web/server/app.ts` or a focused static-serving helper; relevant server/browser tests. Do not edit `runtime.ts` or `WorldExperience.tsx`.

**Interfaces:** Existing component props and HTTP routes remain compatible. Home poster is immediate; visible/idle preview can create at most one runtime. Mutable resources use revalidation; hashed build assets alone may use immutable caching.

- [x] Add failing integration tests for 200 validators, matching 304, updated resource 200 and cache policy by asset class.
- [x] Implement stream-based static delivery with conditional requests and safe path handling.
- [x] Introduce experience/preview lazy imports, preserve the existing poster and handle pending/error/unmount states.
- [x] Add browser checks for home poster, live-preview lifecycle and lazy entry; compare production module closures.
- [x] Run focused tests and report measurements or remaining limits.

### Task 4: Runtime integration and evidence

**Files:** remaining `packages/engine/src/runtime.ts` blocks; story-runtime and screenshot tests; validation/architecture documentation.

**Interfaces:** Consume Task 1 `interactionStatus`; keep callbacks and SceneSpec serialization compatible. Do not start edits while Task 2 owns the runtime file.

- [x] Add failing real-earth-scene nearest-task regression with flags `garden`, `friend`, `wheat`, player at garden, expected `reflection`.
- [x] Prioritize unfinished available interactions; use actual effective visibility and existing range rules.
- [x] Disable drawing-buffer preservation and make `screenshot()` render synchronously before capture; verify actual PNG content in browser.
- [x] Run full unit/integration, typecheck, production build, format, audit and relevant browser/export suites.
- [x] Confirm all model/source hashes match the base, obtain independent code review, and prepare a reviewable branch and draft PR with measured results. Publication remains a separate coordinator action.
