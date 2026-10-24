# UE5 CAD Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Select and inspect external STEP/STP in the running native UE5 application.

**Architecture:** An offline bundled Node/OCCT subprocess produces a validated SceneSpec, GLB and extended canonical catalog in a fresh import directory. UE keeps the existing scene until conversion completes, installs only a current request, and retains existing scene choices.

**Tech Stack:** UE5.8 C++/Slate/DesktopPlatform, Node24/npm, OCCT 0.0.23 WASM, glTF Transform, esbuild.

**Spec:** docs/superpowers/specs/2026-10-23-unreal-cad-import-design.md

## Global Constraints

- Retain source/optimized/manifests separately; retain validation warnings and original units converted to metres/Y-up.
- SceneSpec is serialized authority; use validated atomic SceneCommands; no inferred engineering confirmation.
- No Studio/network dependency; no generated-code execution; bind subprocess results to scene/request generation.
- Reuse native orbit/zoom and stable inspection light; do not overwrite existing scenes or input files.

## Review Focus

- Unicode, spaces and quotes in paths must remain data, never shell commands.
- Invalid/empty/oversize STEP and failed subprocess must preserve the active scene.
- Cancellation, scene switch and shutdown must reject stale import completion.
- A bundled helper copied outside the repository must work with Node24, without npm install/network.
- Multiple imports must retain original scenes and usable camera bounds for tiny/large parts.

## Task 1: Offline converter and export bundle

Files: generators/scene-builder/src/native-cad-import.ts, native-cad-bundle.ts, package exports/dependencies, scripts/native-cad-worker.ts, engine-export/index.ts, tests/assets/native-cad-import.test.ts.

- [x] Write/run failing tests for real STEP cube, multipart STP, Unicode source paths, retained source/hash/warnings, invalid input and unchanged old catalog.
- [x] Implement importNativeCad({input, output, catalog}) with exclusive output, bounded input, OCCT metres, final GLB validation/reload, atomic SceneCommands and catalog extension.
- [x] Bundle helper plus pinned OCCT JS/WASM/license in native project preparation; use esbuild and explicit workspace dependencies. Verify copied standalone helper in isolated directory.
- [x] Run focused tests and full suite; commit independently.

## Task 2: Native UI and asynchronous import lifecycle

Files: native/unreal/Source/VirtualWorld/{Public/VirtualWorldRuntime.h,Private/VirtualWorldCadImport.cpp,Private/VirtualWorldRuntime.cpp,Private/VirtualWorldHUD.cpp,Private/VirtualWorldStory.cpp,Private/VirtualWorldCharacter.cpp}, VirtualWorld.Build.cs, Scripts/native.mjs.

- [x] Add Import STEP/STP [O], cancel and import status; native file dialog with Slate path fallback.
- [x] Start/poll/terminate local helper using request JSON, a fresh job directory, timeout and scene generation; handle EndPlay; no shell interpolation of source paths.
- [x] Validate result catalog before swapping, roll back on failed load, retain existing scenes; frame final bounds and use stable inspection lighting for industrial scenes.
- [x] Build real UE5; run native smoke and command-line-driven import of real multipart STP, plus cancellation/error preservation checks.

## Task 3: Visual acceptance and final review

- [x] Verify visible real UE assembly geometry and actual dimensions; test invalid files and shutdown cancellation. Native file selector compiled; direct dialog clicking not executed because desktop automation selected another Unreal project.
- [x] Run npm test/check/build/format checks appropriate to changes and verify native compiled output.
- [x] Document Node24/local helper, source retention and real executed checks; request one independent review and address important findings.
- [x] Commit verified import changes on codex/ue5-lighting-step-import. Do not merge/push without request.
