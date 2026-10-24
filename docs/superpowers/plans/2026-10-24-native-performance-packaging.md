# Native interaction, work budget and standalone packaging

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkboxes for tracking.

**Goal:** Remove unnecessary native frame work, improve CAD pointer controls, and verify a local standalone application with a documented Windows build route.

**Architecture:** Keep physical time/1000RPM/101 and immutable CAD unchanged. Build principle geometry once, then update only while visible and changed; reuse procedural topology, avoid unchanged component transforms. Use one panel boundary for pointer routing, raw-delta orbit with absolute-position fallback, middle pan, accumulated wheel and first-drag suppression. Extend existing packaging helper with archive/configuration controls and a licensed local Node runtime for offline STEP import in a direct launch.

**Spec:** User reports slow keyboard/mouse and asks to optimize UE performance/mouse operation and independent packaging including Windows. This corrects existing implementation; no change to approved mechanical design or transparent inspection.

**Tech stack:** UE5.8 C++, native Node24 scripts, UAT, existing tests.

## Constraints and review focus

- Reuse current PR19 checkout. Never change input/output physical ratio or clock to create apparent speed.
- Hidden principle geometry must not be rebuilt; showing it must synchronously catch up. Paused geometry must not churn. Clear caches on scene changes.
- Keep actual normals/cam/closed strips and all existing mechanical checks. Measure same CPU work before/after; do not equate actor CPU timing with total FPS or hardware latency.
- Pointer drag begins only in scene, no jump on press/re-entry, panel wheel does not zoom, pan scale uses viewport/FOV. Keep full orbit and existing keyboard shortcuts.
- Preserve materials, visibility, CAD hashes and final node identities.
- Packaging is host-native: Mac→Mac; Windows→Win64. Validate target/configuration and paths before running tools. No false Windows binary claim from Mac.
- Bundle only installed host Node executable and its license when offline CAD helper exists; no network runtime downloads. Direct launch may use bundled Node or explicit environment override. Keep binaries/private CAD ignored.

### Task1: Measure and fix frame/input work

**Files:** native Runtime.h/Runtime.cpp, CadJoint.cpp/Tests.cpp, Character.cpp, Mechanism.cpp, HUD.cpp, DefaultEngine.ini.

- [x] Add actual-CAD benchmark and hidden/visible geometry regressions; record baseline RED and per-call timings.
- [x] Cache principle visibility/phase, update sections in place after first topology creation, skip unchanged transforms, and reduce HUD wrapping cost.
- [x] Add/test pointer routing, orbit/pan/zoom and first-event behavior; disable mouse smoothing.
- [x] Compile, run full native and real window input checks; compare same benchmark and preserve1000/101.

### Task2: Standalone build path

**Files:** native Scripts/native.mjs and new Scripts/package-runtime.mjs; CadImport.cpp; README-Unreal.md; tests/engine/native-package.test.ts.

- [x] RED helper tests for supported host targets, config/archive validation and runtime/license inclusion without downloads.
- [x] Implement archive/configuration options, host-safe target checks and bundled runtime discovery.
- [x] Build/package Mac application, launch independently with canonical real CAD, verify control/transparent view and record exact result. Windows commands/source preparation are checked locally; actual Windows build requires Windows host.
- [x] Full software/check/build/format/browser checks, final independent review, evidence and PR19 update.

**Final evidence:** see the2026-10-24 performance/packaging entry in `docs/validation-native-engines.md`. Task2 playback/package validation completed; direct packaged STEP import remains explicitly unverified/blocked by the default Mac sandbox. The attempted non-sandbox configuration was rejected by automatic approval review and withdrawn; the user explicitly chose to retain the sandbox and defer scoped file-selection/storage adaptation. Windows native build is unrun. These limits do not block the requested performance fix or alter section/motion/transparency.
