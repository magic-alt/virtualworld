# Platform Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement the independent tasks and review the
> integrated branch. Steps use checkbox syntax for tracking.

**Goal:** Strengthen model fidelity, bounded backend execution and protected
single-instance team hosting without replacing the shared runtime.

**Architecture:** Keep the modular monolith and explicit content contracts.
Separate access policy, data ownership and expensive-operation admission from
route handlers. Private hosted mode is one shared workspace, not tenant isolation.

**Tech Stack:** Existing pinned Node.js 24, Fastify, Three.js, Zod, fflate, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-platform-foundation-design.md`

## Global Constraints

- Preserve package-lock.json, pinned dependencies, GLBs and world templates.
- Preserve metres, Y-up, radians, SceneSpec and atomic SceneCommands.
- No live paid generation, secret exposure or automatic paid-create retries.
- Node.js 24 and npm; use public workspace entry points.
- Keep local mode compatible; no claim of tenant isolation or real-time play.

## Review Focus

- Animation/bone references must survive import and per-instance disposal.
- Queue saturation must not break idempotent replay or permit resume overflow.
- A second service must fail before changing another service's job state.
- Auth must cover raw asset/static access and clients without Origin headers.
- Export byte limits must include shared chapters and stop before huge reads.

## Task 1: Asset fidelity and publication validation

Files: `apps/web/src/import.ts`, `generators/scene-builder/src/assemble-import.ts`,
`generators/scene-builder/src/asset-library.ts`, relevant `packages/asset-runtime`
code, `tests/assets/*`, existing upload fixtures in `tests/engine/server.test.ts`.

Interface: retain `groupCommands(group, asset, name)` compatibility, optionally
accept clip metadata; `recordUpload()` validates runtime GLBs and retains a
`validation` report. Server still receives `{ filename, manifest }`.

- [x] Reproduce broken complex GLB import and unsupported upload acceptance.
- [x] Implement full-root preservation where decomposition is lossy; preserve
      visibility and clips and independent skeleton ownership.
- [x] Enforce server GLB validation before any upload files/manifests are written.
- [x] Run import/animation/upload tests including valid replacement fixtures.

## Task 2: Service ownership, queue bounds and catalog reuse

Files: `apps/web/server/generation.ts`, `apps/web/server/store.ts`, new
`apps/web/server/service-lease.ts`, and focused engine tests. Coordinator owns
`app.ts` integration.

Interfaces: `GenerationService(dataRoot, projectRoot, llm, {maxPending?: number})`
with default 8, diagnostics via `capacity()`. Export
`acquireServiceLease(root): Promise<() => Promise<void>>` with idempotent release.
`ProjectStore` accepts optional additional world roots for durable generated
content, preserving existing default constructor behavior.

- [x] Write/observe failures for capacity, idempotency while full, resume,
      post-close admission, second-instance lease, catalog scan count/overlay.
- [x] Add bounded admission while keeping one-at-a-time generation and paid
      ledger behavior; add conservative exclusive service lease.
- [x] Reuse one world catalog per list request; preserve new-world discovery,
      saved overlays, retired IDs and chapter metadata validation.
- [x] Run targeted generation, store and lease tests; report integration hooks.

## Task 3: Bounded asynchronous exports

Files: `apps/web/server/export.ts`, new export tests; coordinator owns route
admission. Interface extends createExport options with `maxBytes?: number`
(default 256 MiB) and `signal?: AbortSignal`, preserving existing call sites.

- [x] Reproduce acceptance above byte budget and lack of cancellation.
- [x] Preflight/read bounded contained files, deduplicate repeated sources,
      validate GLBs, reject raw STEP runtime references and unsafe symlinks.
- [x] Use asynchronous fflate zip, propagate cancellation and retain offline
      chapter paths and licenses; count metadata in total export budget.
- [x] Run export/campaign regressions and document actual memory boundary.

## Task 4: Access policy, deployment and integration

Files: new `apps/web/server/config.ts`, `access.ts`, `admission.ts`, `app.ts`,
`index.ts`, deployment files, `.env.example`, deployment/API tests and docs.

- [x] Test local binding/Host and hosted missing-secret/origin failure, protected
      API/static routes, wrong secrets, no-Origin clients and safe errors.
- [x] Implement explicit config, gateway access policy, per-route body limits,
      minimal liveness and operation admission (agent 2, export 1).
- [x] Acquire lease before job recovery; create durable generated content paths
      and make project/asset/export readers aware of bundled plus generated roots.
- [x] Provide container/TLS/authenticating proxy example and backup/restart guide.
- [x] Verify real hosted HTTP requests and persistent world retrieval after restart.

## Task 5: Integrated review and delivery

- [x] Run unit/integration, typecheck, build, format, browser/WebGL regressions,
      dependency audit, unchanged GLB checks and focused deployment checks.
- [x] Independently review branch and fix material findings with regressions.
- [x] Update audit/deployment documentation with exact executed evidence and
      staged architecture for public viewing, team editing and future multiplayer.
- [ ] Commit, push feature branch and open a reviewable PR; do not merge/deploy.
