# Reference architecture implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks in this session. The user has explicitly requested implementation.

**Goal:** Align the existing working application with the user's ai-3d-world-generator architecture and the shared conversation's local generation pipeline.

**Architecture:** Separate schema, runtime assets, interaction, rendering and offline generators into actual workspace modules. Compile versioned world documents into SceneSpec; the editor and exported player consume the same runtime. Keep the existing local API inside apps/web and retain existing project IDs and saved data.

**Tech Stack:** Node 24, npm workspaces, TypeScript, React, Three.js, Spark, Rapier, Zod, glTF Transform, Khronos glTF Validator, optional Blender Python and Tripo v3.

**Spec:** User directory tree and https://chatgpt.com/share/6ad3932f-7324-83ec-901a-2e1392061887 (retrieved 2026-10-17).

## Global constraints

- SceneSpec is the serialized source of truth; atomic commands, metres, Y-up, radians and stable IDs remain.
- The generation CLI may call providers; the renderer/player never imports generators or secrets.
- Preserve both demos, CAD units/hierarchy, stale-request protection, GPU disposal and standalone export.
- No paid calls without supplied credentials; distinguish HTTP fixture tests from live provider verification.
- Fixed Blender batch scripts only; no generated Python or JavaScript execution.
- Work in the current authorized project directory; no duplicate nested application.

## Review focus

- Interrupted or concurrent Tripo creation must not silently create duplicate paid tasks.
- Malformed world story/asset references must fail before changing an existing output.
- Asset manifests must identify input/output hashes and actual tool/provider versions.
- Saved progress must not cross world/story revisions, corrupt storage or mutate SceneSpec.
- Moving files must preserve dev/build/export entry points and legacy saved asset paths.

### Task 1: Real workspace boundaries and world compilation

**Files:** apps/web/{src,server,player}, packages/{scene-schema,engine,interaction,asset-runtime}, generators/{planner,scene-builder}, worlds/{demo-island,demo-industrial}, tests/{assets,engine,e2e}.

**Interfaces:** Public workspace exports; assembleWorld(scene, story, assets): SceneSpec; splitWorld(SceneSpec): WorldBundle. Runtime packages cannot depend on generator/application code.

- [x] Add world round-trip, dangling reference and dependency-boundary tests; confirm initial failure.
- [x] Move existing code, rewrite imports to public package entry points, migrate demo content into three versioned JSON documents per world, update Vite/npm/browser paths.
- [x] Run typecheck and existing unit tests; keep the old data directory and asset URLs readable.

### Task 2: Asset runtime and game progress

**Files:** packages/asset-runtime/src/{registry,cad,glb}.ts; packages/interaction/src/{story,character,avatar,save}.ts; packages/engine/src/runtime.ts.

**Interfaces:** AssetRegistry owns GLB cache/instances and Spark lifecycle; SaveSystem loads/saves/resets validated story progress independently of SceneSpec.

- [x] Add cache/clone/disposal and progress isolation/corrupt-storage tests.
- [x] Route real runtime asset loads through AssetRegistry; move import assembly to scene-builder.
- [x] Persist/resume/reset progress in the shared runtime and expose reset in the exported player.
- [x] Run unit tests and renderer smoke checks.

### Task 3: Deterministic asset production and provenance

**Files:** generators/scene-builder/src/{io,pipeline,cli}.ts; generators/blender/{src/index.ts,optimize.py}; assets/{source,optimized,manifests}; tests/assets/pipeline.test.ts.

**Interfaces:** optimizeGlb(input, output) returns validator report and hashes; write/readWorld(root) compiles the three documents; fixed Blender invocation uses execFile and checked JSON options.

- [x] Add valid/invalid GLB and world-output tests.
- [x] Implement glTF Transform dedup/weld/prune and Khronos validation; add fixed optional Blender processing.
- [x] Generate reproducible built-in asset manifests and expose local generated worlds through the app.
- [x] Run actual local optimization and validator checks; record Blender availability separately.

### Task 4: Planner, Tripo and end-to-end generation CLI

**Files:** generators/planner/src/index.ts; generators/tripo/src/index.ts; generators/scene-builder/src/{generate,cli}.ts; tests/assets/tripo.test.ts; tests/engine/generation.test.ts.

**Interfaces:** Existing propose API remains; generation CLI plans from description/reference image, resolves procedural or Tripo assets, validates and writes worlds/<id> and provenance. Tripo create/poll/download supports persistent task reuse, bounded retries, timeout/cancellation and concurrent request deduplication.

- [x] Add fake HTTP provider tests for success, task resumption, failures, timeout and no creation retry after uncertain errors.
- [x] Implement configurable Tripo v3 and LLM planners without browser keys; add explicit offline procedural mode.
- [x] Generate two different descriptions through the same CLI, validate their outputs and open a generated world in the editor.
- [x] Document exact credentials, commands, module ownership and unimplemented extensions (spherical navigation, provider/mobile matrix, Blender execution if unavailable).

### Task 5: Verify and deliver

- [x] Run npm test, npm run check, npm run build, npm run test:browser, npm run format:check and npm audit.
- [x] Inspect dependency direction, diff, generated manifests and browser evidence; fix regressions.
- [x] Update architecture/validation/readme and plan checkboxes with actual outcomes, then commit locally.
