# Unreal Mouse Controls Implementation Plan

**Goal:** Restore native mouse inspection of H-100 while preserving HUD and keyboard input.
**Architecture:** Small deterministic pointer-gesture state, consumed by the existing native camera input path; no additional application dependency.
**Tech Stack:** Unreal C++, Node 24, existing export tests.
**Spec:** docs/superpowers/specs/2026-10-23-unreal-mouse-controls-design.md

## Global Constraints

Metres/Y-up serialized scenes remain unchanged. Keep GLBs, progress and mechanism state intact. Launch windowed at 1280x720. Do not certify unexecuted manual or packaging checks.

## Review Focus

Panel-origin drags cannot orbit. Focus loss cancels stale movement. Switching drag modes establishes a fresh origin. HUD wheel scrolling cannot zoom the model. Prince left-click interaction remains available.

- [x] Add native pointer boundary tests; observe missing-feature compile failure.
- [x] Implement pointer tracking, orbit/pan/zoom integration, shared HUD width and hints; retain local UE5.8 compatibility/collision/lighting/window fixes in export templates.
- [x] Compile both native projects, run native pointer automation and fresh rendering smoke, run repository tests/type/build/format checks, then inspect the windowed mouse behavior where desktop interaction permits.

## Execution results

Both UE5.8.4 projects compile and pass fresh rendered smoke. Native automation: 8 passed, 0 failed. Repository: 413 tests in 66 files passed on the final original-command rerun; production build (including types) and format check passed. Retained failure notes are in output/unreal-review-20261023/local-verification.json. UI observations confirmed left orbit, viewport wheel zoom, HUD-only wheel scrolling and mouse section toggle. Physical middle-pan feel, full hardware focus/exit handling, full manual model/story/performance and offline packaging gates remain pending. No model GLBs or SceneSpec were changed. Deliver through a dedicated topic branch and PR; merging is outside this task.
