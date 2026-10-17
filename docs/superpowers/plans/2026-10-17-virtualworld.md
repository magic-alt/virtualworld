# VirtualWorld Studio Implementation Plan

> For agentic workers: use superpowers:executing-plans inline. User requested implementation of the approved plan.

**Goal:** Two editable, exportable AI-assisted 3D demos on Windows.
**Architecture:** Shared typed scene commands feed React studio and standalone Three.js runtime. Local Fastify handles persistence, LLM and export. Import CAD in a browser worker.
**Tech Stack:** TypeScript, React, Vite, Fastify, Three.js, Spark, Rapier, Zod, Vitest, Playwright.
**Spec:** ../specs/2026-10-17-virtualworld-design.md

## Global constraints
- 100 MiB per imported file. Metres/Y-up/radians. Server binds 127.0.0.1.
- No credentials in client/export. No generated JS execution. Built-in demos work without API keys.
- Preserve actual execution boundaries in validation report.

## Review focus
- Atomic rejection of bad commands and stale revisions.
- Untrusted filenames/references cannot escape storage.
- Imported transforms/unit scale survive export.
- Play mode never changes saved editor state.
- Export loads relative bundled assets without CDN.

## Task 1: Scene model and deterministic behavior
Files: packages/scene/src/{schema,commands,demos,story}.ts; tests/scene.test.ts.
Interfaces: SceneSpec, SceneCommand, applyCommands, SceneHistory, advanceStory.
- [x] Write/run failing tests for atomic edits, conflicts, graph validity, history and story completion.
- [x] Implement schema, validation, commands and templates; run npm test.

## Task 2: Local server and AI boundary
Files: apps/server/src/{app,store,agent,export,index}.ts; tests/server.test.ts.
Interfaces: /api/projects, /api/projects/:id, /api/assets, /api/agent, /api/export.
- [x] Write failing integration tests with temporary storage and local model HTTP server.
- [x] Implement atomic persistence, limits, model calls, cancellation/export; run npm test.

## Task 3: Runtime and assets
Files: packages/runtime/src/{runtime,geometry,character,interactions}.ts; scripts/fixtures.ts.
Interfaces: StudioRuntime(container, scene, callbacks), load/dispose/play/select/explode.
- [x] Establish browser acceptance script before implementation.
- [x] Implement assets, mesh+splat loading, transforms, collision, animation and interactions.

## Task 4: Studio and import
Files: apps/studio/src/{App,Viewport,Inspector,import,step.worker}.tsx/ts; styles.css.
- [x] Implement editor, project flows, AI preview, STEP worker and resource import through shared commands.
- [x] Verify conversion, selection, history and demo completion in browser.

## Task 5: Export and qualification
Files: apps/player/src/main.ts; scripts/browser-check.mjs; README.md; docs/validation.md.
- [x] Build studio/player; run tests and browser workflows.
- [x] Test exported experiences under subdirectory with external network blocked.
- [x] Record screenshots, performance, executed/unexecuted checks.
