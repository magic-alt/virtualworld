# Unreal Local Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Prince and H-100 Unreal source projects practical to prepare, run and inspect on the user's installed UE5.

**Architecture:** Preserve the two exported project boundaries; generate an acceptance kit with a standalone Node launcher. Improve engine discovery and diagnostics in each exported project. Fix native runtime blockers independently and keep native/manual evidence distinct.

**Tech Stack:** Node.js 24, TypeScript, Vitest, Unreal C++, pinned glTFRuntime.

**Spec:** `docs/superpowers/specs/2026-10-23-unreal-local-acceptance-design.md`

## Global Constraints

- Preserve models, worlds, SceneSpec, package-lock and Unity behavior.
- glTFRuntime pin: `0b22180d5d5d48b13457b683f4405113b6afd87b`.
- No generated/native build binaries committed; no false native validation claims.
- Windows paths with spaces and Chinese names must be preserved; reject dangerous batch metacharacters explicitly.
- New output directories never replace existing user work or symlinks.

## Review Focus

- Multiple installed UE versions, malformed installation metadata, explicit invalid paths: deterministic actionable errors.
- Missing Visual C++/SDK/plugin: diagnose before ambiguous engine launch failures.
- Repeat invocation or process failure: preserve user data, logs and actual exit status.
- Stale native reports: do not certify a new run using old evidence.
- Native preview duplication, collision, character radial frame and mechanism camera: source review plus actual-engine acceptance remains mandatory.

## Task 1 — Exported native launcher

**Files:** `generators/scene-builder/src/engine-export/native/unreal/Scripts/*`, `.uproject`, `tests/engine/unreal-local-runner.test.ts`.

**Interface:** `nativeCommand(argv, projectRoot)` keeps data/prerequisite errors synchronous and awaits actual native processes. CLI commands: `doctor`, `prepare`, `generate`, `open`, `check`, `build`, `run`, `smoke`, `package`, `evidence`; engine selection via `--engine` or discovery. `check --data-only` remains offline.

- [x] Add behavioral tests for engine discovery/version/paths, strict option parsing, failed commands and evidence integrity; observe expected failures.
- [x] Implement detection, diagnostics and recorded subprocess execution; preserve dependency pin.
- [x] Verify focused tests and review generated-project behavior.

## Task 2 — Native scene readiness

**Files:** `native/unreal/Source/VirtualWorld/{Public,Private}/*`, targeted native tests and export capability declarations.

- [x] Audit pinned importer APIs and runtime startup; report concrete defects.
- [x] Fix proven import/collision/control issues and implement stateful Prince jump/landing where scoped safely.
- [x] Add native automation coverage for affected behavior; label it unexecuted without UE.
- [x] Review source against upstream API and communicate remaining native gates.

## Task 3 — Acceptance kit and documentation

**Files:** `scripts/unreal-acceptance.ts`, `scripts/unreal-review-runner.mjs`, `package.json`, `tests/engine/unreal-acceptance.test.ts`, `docs/unreal-local-acceptance.md`, README and generated READMEs.

**Interface:** `prepareUnrealAcceptance({out, projectRoot?})` exports prince and joint projects. Standalone `review.mjs` provides menu/doctor/setup/build/open/play/smoke/report and forwards engine path without shell interpolation.

- [x] Test fresh-output protection, generated case map, standalone runner dispatch and truthful pending/manual report.
- [x] Generate complete local kit and Windows menu; record revision/provenance and user-facing checklists.
- [x] Execute real data exports and failure paths; document exact user steps and limits.

## Task 4 — Integration and delivery

- [x] Independent review of launcher and native runtime changes; resolve concrete findings.
- [x] Run repository tests, typecheck, build, format and relevant data/browser regression checks.
- [x] Record executed results and outstanding native-only gates.
- [x] Commit and publish a focused PR against latest main; do not merge or assert local UE success.

## Execution record

See `docs/validation-unreal-local-acceptance.md` for executed checks, the initial concurrent-test failures and successful isolated rerun, audit findings, actual dependency preparation, and native-only gates. Publication is a draft PR against verified main; no merge or native completion is authorized by software checks.

Published as [draft PR #16](https://github.com/magic-alt/virtualworld/pull/16) from
`feat/unreal-local-acceptance-20261023`, based on `eced5499b0e34fa115f8a3f7125cf83d4e4e53c5`.
The reviewed implementation commit is `7cc42bcb77c38eb04834178fdee07da0456aff32`.
