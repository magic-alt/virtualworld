# UE5 Single Module STEP Import Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Track completed checks here.

**Goal:** Import one local STEP assembly at a time directly in the UE5 joint GUI.
**Architecture:** Bundle the pinned local OCCT converter and validated SceneSpec command pipeline into exported projects. Stage a hidden native candidate and commit it only after successful geometry loading. Poll a cancellable child process; preserve the current model on failure.
**Tech Stack:** TypeScript, Node.js 24+, OCCT 0.0.23, glTF Transform, Unreal C++, Windows file dialog, glTFRuntime.
**Spec:** `docs/superpowers/specs/2026-10-23-unreal-single-module-stp-import-design.md`.

## Global Constraints

- No network or provider credentials during import; source/optimized/manifests remain distinct.
- SceneSpec is authoritative, edits use validated atomic SceneCommands; metres, Y-up, stable IDs.
- One STEP assembly is one module, even when it contains multiple meshes.
- Failed, cancelled or stale work cannot replace the current module.
- Use the user-requested existing feature branch in place; no additional worktree or branch is needed.

## Review Focus

- Unicode and spaced paths: pass paths as quoted process arguments without a shell.
- Malformed/empty/oversized STEP: reject before commit and retain the current model.
- Multi-part assemblies: retain visible meshes, names, colors and metric dimensions.
- Restore/exit during conversion: kill the process and invalidate its generation.
- Standalone exports: ship converter runtime files and notices, independent of repository/server.

### Task 1: Local converter and portable export

Files: create `generators/scene-builder/src/step-import.ts`, `step-import-cli.ts`, `engine-export/step-tools.ts`; modify engine export and workspace dependencies; test `tests/engine/unreal-step-import.test.ts`.
Interfaces: `convertStep(sourcePath: string, outputDirectory: string): Promise<void>` writes source, GLB, SceneSpec, manifest and validator warnings to a fresh directory. `stepToolFiles(): Promise<Record<string, Uint8Array>>` returns portable Content tools including pinned OCCT WASM.

- [x] Write real STEP conversion/export portability tests; run and observe missing implementation failure.
- [x] Implement bounded conversion, canonical export records and command-validated whole-model SceneSpec.
- [x] Test metric cube, colored assembly, malformed/empty source and refusal to overwrite output.

### Task 2: Native GUI and transactional replacement

Files: create `VirtualWorldImport.cpp` and import state helper; modify runtime header, HUD, controls, build/staging configuration; add Unreal automation tests.
Interfaces: `BeginStepImport()`, `PollStepImport()`, `CancelStepImport()`, `CommitStepImport(directory)` manage one child conversion and hidden candidate. `IsModuleViewer()` covers both default H-100 and imported static model.

- [x] Write automation tests for commit/cancel/generation and failed replacement retaining current actor.
- [x] Add Windows single-file dialog, cancellable timed child process and actionable status.
- [x] Validate bytes/digest/manifest, load hidden candidate, check actual geometry, swap one module and release old resources.
- [x] Add import/restore/cancel GUI actions; omit H-100 controls for static STEP and retain orbit/pan/zoom.

### Task 3: Verification and documentation

- [x] Document Node requirement, offline usage and source versus native verification boundaries.
- [x] Run `npm test`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run format:check`, `npm audit`.
- [x] Run available real UE build/import automation; report unavailable checks explicitly.
- [x] Review complete diff, fix material issues, report branch and executed results.
