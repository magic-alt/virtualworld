# Engine Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans. Steps
> use checkbox syntax. Execute the authorized stage without confirmation pauses.

**Goal:** Export usable Unity/Godot scene projects from the existing studio.

**Architecture:** Derive canonical GLBs and a versioned engine manifest from
SceneSpec. Target adapters consume that manifest; the server reuses one bounded
asset snapshot and asynchronous archive path for web and native targets.

**Tech Stack:** Pinned Three r180, glTF Transform 4.5.1, Node 24, Fastify, Vitest;
Unity 6/glTFast 6.14.1 and a specifically verified Godot 4 binary.

**Spec:** docs/superpowers/specs/2026-10-19-engine-interop-design.md

## Global Constraints

- Node.js 24 and npm; preserve pinned third-party versions and package-lock.json.
- Preserve existing model bytes, world templates and license contents.
- Use public workspace exports; runtime packages never import Node/generators.
- SceneSpec is authoritative; metres, Y-up, radians, stable IDs and atomic commands.
- No paid provider calls, secret exposure, main merge or external deployment.
- Run focused tests per stage; run the complete regression matrix at the end.

## Review Focus

- Mixed-axis rotations and reflected asymmetric geometry must agree in target engines.
- Three assetNode paths must select the same geometry after canonicalization.
- Hidden ancestors and nonuniform scale must not silently create incorrect collision.
- Native export must retain campaign assets and the existing cancellation/byte budget.
- A failed native import must preserve user project files and dispose partial objects.

## Task 1: Canonical assets and native project adapters

**Files:** Create generators/scene-builder/src/engine-export/{index,manifest,assets}.ts
and focused unity/godot emitter files/templates; expose ./engine-export from
generators/scene-builder/package.json. Create tests/engine/engine-export.test.ts.

**Interfaces:** Export `EngineTarget = 'unity' | 'godot'` and
`writeEngineExport(options): Promise<void>`. Options contain target, validated and
asset-relocated scenes: SceneSpec[], entrySceneId: string,
assetBytes: (url:string) => Uint8Array,
primitiveFactory: (node:SceneNode) => THREE.Object3D,
emit: (path:string,bytes:Uint8Array) => void, and optional signal: AbortSignal.
The caller's emit enforces budget immediately. The caller retains original assets,
SceneSpec files and licenses. The generator emits manifest, compatibility report,
canonical derived assets and target project files. It does not read user paths.

- [x] Write focused failing tests that inspect actual derived GLB data and loader
      output: asymmetric nested transforms, joint XYZ quaternion, source assetNode
      selection, procedural cylinder/tree dimensions, override material, original
      byte retention, identity roots, hidden ancestors, collider radius, campaign
      scene identity and structured unsupported findings.
- [x] Run `npx vitest run tests/engine/engine-export.test.ts` and record the red
      behavior before implementation.
- [x] Implement versioned manifest and GLB normalization using existing geometry
      factory and NodeIO. Resolve assetNode through actual pinned loader mappings;
      preserve embedded source images without browser image decoding.
- [x] Emit usable Unity Editor import code, metadata and safe fresh-prefab output;
      emit Godot project/import/save/inspection entry points and packaged raw assets.
- [x] Run focused tests, `npm run check`, and scoped formatting. Self-review
      cleanup, unsafe paths, missing parents, shader/material limitations and empty
      model results. Commit generator and test files only.

## Task 2: Shared archive path, HTTP and Studio integration

**Files:** apps/web/server/export.ts and a focused archive helper if necessary;
apps/web/server/app.ts; apps/web/src/StudioApp.tsx and styles as needed;
tests/engine/export-targets.test.ts; docs/engine-interoperability.md;
scripts/verify-godot-export.ts and a focused browser export check.

**Interfaces:** createExport's existing options gain optional
`target: 'web' | EngineTarget`, default web. It invokes writeEngineExport with
already validated asset bytes and the existing budgeted add callback. Server
POST /api/export accepts `{scene,target?}`. Native requests do not require a
player build; the existing endpoint/gate/cancellation lifecycle is retained.

- [x] Write failing endpoint/export tests for native exports without a player,
      invalid enum, derived-content budget overflow and cancellation. Keep web,
      campaign and HTTP-disconnect coverage meaningful.
- [x] Integrate shared asset collection and target-specific emitted files without
      copying the security-sensitive reader/ZIP implementation. Supply primitive
      from public @virtualworld/engine/geometry at the application boundary.
- [x] Add accessible target selection with default web action and useful native
      download messages. Preserve existing browser selectors and save/edit scope.
- [x] Run focused export/API regressions and a browser download smoke. Run Godot
      headless inspection on a hand-checked asymmetric fixture, including native
      mesh bounds, wrapper transforms, collision and editable PackedScene output.
- [x] Document exact target support, unimplemented gameplay and executed evidence;
      commit and independently review the stage.
- [ ] Controller publication: publish the verified branch and open its PR.

## Final cross-stage gate

- [ ] After streaming and GPU stages, run the full repository regression matrix
      and independent whole-stack review, recording final evidence and remaining
      target-engine/hardware limits in the final stage PR and technical roadmap.
