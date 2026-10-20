# Native engine runtimes implementation plan

> **For agentic workers:** Use superpowers:executing-plans; independent native adapters may be delegated with exclusive file ownership.

**Goal:** Deliver Unity/Unreal native runtime sources for existing showcases and honest selectable engine surfaces.
**Architecture:** One SceneSpec source, a versioned derived manifest, two native runtime adapters, existing web authoring.
**Tech Stack:** Node 24, TypeScript, React, Unity 6 C#, Unreal 5 C++, glTFast 6.14.1 and pinned glTFRuntime.
**Spec:** `docs/superpowers/specs/2026-10-21-native-engine-runtimes-design.md`

## Global constraints

- Preserve source/optimized models, worlds, licences and dependency lockfile.
- Keep metres, Y-up, radians and stable IDs in the source manifest.
- Use validated exports, contained assets, cancellation and existing archive budgets.
- Never mark native compilation or rendering verified without executing the engine.
- Independent native projects need no Studio service during playback.

## Review focus

- Actor assets without authored nodes must be exported and instantiated exactly once.
- Reflections, unit conversion and morph weights must match each model importer's basis.
- Chapter and interaction prerequisites must survive native export.
- Configured browser surfaces must not mix projects, leave a hidden Three runtime or silently fall back.
- Missing native SDKs/plugins and unsupported features must fail or report clearly.

## Task 1: Native export contract and reproducible projects

Files: engine-export/index.ts, manifest.ts, native export CLI, HTTP export target,
tests/engine/native-runtime-export.test.ts, export-targets.test.ts.

- [x] Write/run failing real-export tests for Unreal, actor-only assets, campaign retention and exact budgets.
- [x] Add `unreal` target; retain manifest version 1 with optional `actorModel` on scenes and `campaign` at root.
- [x] Emit runtime sources and a project-preparation command with safe fresh output.
- [x] Run export tests and TypeScript checks; commit the contract and adapters together once consistent.

## Task 2: Unity runtime

Exclusive files: engine-export/unity.ts, engine-export/native/unity/\*\*,
tests/engine/unity-runtime-export.test.ts.
Consumes manifest.scene metadataJson plus actorModel, assets and optional campaign.
Produces `unityFiles(): Record<string,string>` with importer, playable native scene,
runtime controls and an Editor build/smoke entry point.

- [x] Extend generated Unity importer with runtime components and actor model binding.
- [x] Implement character navigation/animation, story/campaign, mechanism and free orbit.
- [x] Provide BuildBatch/ValidateBatch and native tests; record engine availability honestly.

## Task 3: Unreal runtime

Exclusive files: engine-export/unreal.ts, engine-export/native/unreal/\*\*,
tests/engine/unreal-runtime-export.test.ts.
Consumes the same manifest; produces `unrealFiles(): Record<string,string>`.

- [x] Pin/import glTFRuntime via documented APIs, preserve notices.
- [x] Build C++ native project, model graph, character/story and mechanism components.
- [x] Add native smoke instructions and dependency/engine checks, no success simulation.

## Task 4: Web surfaces and delivery

Files: apps/web/src/engine-_, apps/web/server/engine-_, config.ts, app.ts,
WorldExperience.tsx, StudioApp.tsx; tests and docs.

- [x] Test configured URL policy, project binding, missing runtime and explicit selection.
- [x] Mount the selected engine independently; dispose native/Three surfaces on switch.
- [x] Add Unreal downloads and local native export/build commands.
- [x] Run complete software regression, browser checks and fresh review; fix defects.
      Delivery: staged source and documentation commits, then a draft PR with explicit native acceptance gates; no merge or deployment is part of this source handoff.

## Recorded acceptance limits

See `docs/validation-native-engines.md`. Unity/Unreal compilation, actual rendering and deployment remain unexecuted. Unreal jumping is explicitly unsupported. Broad browser regressions have documented intermittent/baseline-reproduced failures; the native-host/export browser gate passed.
