# Local harmonic transparency implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkboxes for tracking.

**Goal:** Inspect the real harmonic reducer through locally transparent occluding parts while retaining complete surfaces and motion.

**Architecture:** Optional per-binding inspectionOpacity selects only documented occluders in the inspection view. Clone runtime materials, preserve geometry/pose/source materials and restore them outside inspection or on disposal. Native uses the pinned glTFRuntime translucent PBR template; web uses cloned Three materials. This is selected-part transparency, not a whole-assembly fade or geometry removal. Motor cuts remain separate.

**Spec:** User explicitly requested local transparency for harmonic internals, following the approved real joint design and corrected chain. Keep bearings exterior-only, no balls, fixed flex/circular output101,1000RPM clock1x.

**Tech stack:** Node24, Zod/Three, UE5.8/material instances.

## Constraints and review focus

- Reuse PR19 branch/current project. No private CAD or generated binaries committed.
- Opacity must be finite and strictly between0 and1; a body cannot be both cut and transparent.
- Only explicitly selected reducer occluders change material. Real wave generator remains solid; circular spline remains complete rather than cut. No bearing internals reintroduced.
- Preserve original multi-material slots, shadows, visibility and source resource ownership. Restore on C/full view, scene disposal and reload; avoid per-frame material allocations.
- Material fallback must keep a visible source and report a warning. Hidden bodies/parents must not reappear.

### Task1: Reversible real-CAD transparency

**Files:** schema/cad-mechanism.ts, engine/cad-joint-view.ts, native Runtime.h/CadJoint.cpp/Mechanism.cpp/HUD.cpp and tests; ignored actual profile installer supplies selected final nodes.

- [x] RED schema, multi-material web restoration/disposal and native actual-material/component regressions.
- [x] Implement per-part inspectionOpacity and native translucent material instances with source material lifetime protection; preserve mesh and101 poses.
- [x] Install validated local profile; adjust only supported reducer occluders after actual rendered inspection.
- [x] Full software/check/build/format, affected browser, UE compile/native tests and ordinary window verification. Record review/evidence and update PR19.
