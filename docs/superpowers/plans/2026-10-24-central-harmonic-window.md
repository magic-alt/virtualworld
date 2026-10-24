# Central harmonic inspection window

> Use superpowers:executing-plans. Small explicit user revision; no mechanical redesign.

**Goal:** Retain an opaque peripheral rear cover and visible circular-spline rotation, with inspection transparency confined to a coaxial central window. Set the real model's authored default motor speed to202RPM, yielding+2RPM at101:1.

**Architecture:** Add optional SI inspectionWindowRadius, requiring inspectionOpacity and excluding cutting. Native uses cached display copies split by a64-sided coaxial prism without caps: aggregate opaque outside fragments by source slot, and translucent inside fragments separately. Union preserves source surface area; no physical geometry edits. Attach display copy to the actual component so all motion continues without per-frame rebuilding. Browser uses equivalent analytic radial alpha in transient material clones. The private real-CAD profile uses measured mesh bounds to select the central radius; all other inspection/motion policies stay intact.

- [x] Add schema, native and browser regressions; observe RED.
- [x] Implement validation, cached native radial display partition and browser material window. Preserve restoration, visibility, multi-material mapping and performance.
- [x] Update private profile/default202 via existing validated prepare/export flow; verify source/GLB hashes and circular-output+2RPM.
- [x] Compile, run native/software checks, verify actual UE rear-center inspection and202/+2RPM. Review changes, commit and update PR19. Keep Mac sandbox unchanged; no unrelated importer work.

**Evidence:** `docs/validation-native-engines.md` latest central-window entry.17 UE checks/464 software tests passed; material-compaction regression RED thenGREEN. Mac archive and ordinary202/+2RPM rear inspection verified.
