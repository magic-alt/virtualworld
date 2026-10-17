# Implementation ledger

Plan: docs/superpowers/plans/2026-10-17-virtualworld.md

- Scene model, command transactions and declarative story implemented; tests were run failing before core implementation and then passing.
- Local storage, provider HTTP boundary and ZIP export implemented; integration tests use temporary storage and actual local HTTP requests.
- Rendering, industrial demo, original story demo, STEP worker and static player implemented.
- Independent read-only review found STEP wrapper-path mismatch, async project scope leakage, model-confirmed joints, GPU helper/shadow cleanup, and import transaction capacity. Regression cases added; all five fixes re-reviewed. Final browser checks passed.
- Ruling: No root-level source license was selected on the user's behalf. Third-party notices and source links are preserved independently.
- Ruling: Demo geometry is original and illustrative. Real STEP fixtures are separately identified upstream OCCT test data, not a customer manufacturing model.
- Ruling: Only the installed Edge browser is available. Chrome, Firefox, Safari and mobile device checks remain unexecuted.
- Final qualification results are recorded in docs/validation.md with references to generated browser evidence.
- Final: 32 unit/integration tests and 21 full browser checks passed; type checks, dual-entry builds, format check and zero-vulnerability dependency audit executed.
- Ruling: Preserve the new local implementation branch in the user-requested empty directory. No remote repository, merge or publication is required by the approved scope.

# Reference architecture migration — 2026-10-18

Plan: docs/superpowers/plans/2026-10-17-reference-architecture.md

- Task 1: complete. apps/web and four runtime packages now use public workspace exports. Demo content lives in validated scene/story/assets documents; legacy project IDs and saved data remain readable.
- Task 2: complete. Real runtime GLB/Spark loads use AssetRegistry. Interaction owns character/avatar/story/save; editor and standalone player resume/reset progress separately from SceneSpec.
- Task 3: complete. source/optimized/manifests contain actual receipts and reproducible recipes. glTF Transform + Khronos validation ran on real GLBs. Fixed Blender Python/execFile pipeline added; actual Blender execution unavailable and not claimed.
- Task 4: complete. Local CLI plans/generates/validates worlds, records provenance, and resolves replaceable procedural/Tripo assets. Two different builtin descriptions generated and opened in the browser. Local HTTP LLM/Tripo integration passed, including uncertain creation, timeout, corruption and key-rotation recovery.
- Ruling: Keep this authorized working directory and existing feature branch; map the requested root name to npm metadata rather than nesting another project. Cost if wrong: directory-only relocation, no data protocol change.
- Ruling: Preserve existing npm/Node24 toolchain. pnpm in the reference was a suggestion; migrating lockfile/toolchain adds no runtime value here. Cost if wrong: future package-manager migration.
- Ruling: Flat movement remains the tested runtime. Spherical navigation, multi-world preload/transfer, cinematic orchestration and Blender MCP remain explicit extensions. Cost if wrong: those use cases need separate implementation.
- Task 5: complete. 51 tests, 25 browser workflows, dual build, world validation, formatting and zero-vulnerability audit executed. Independent Important findings fixed with failing-then-passing regressions and re-reviewed; details in docs/validation.md.
