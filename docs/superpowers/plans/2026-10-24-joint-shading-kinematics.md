# Joint shading and kinematic correction

User requests reducer-side lighting correction and a detailed mechanical/physical audit. Existing intended scope is an educational, prescribed-motion H-100, not a torque/contact solver.

- [x] Reproduce current reducer render and audit serialized normals, lower-hemisphere reflection, shadow scale and exposure.
- [x] Add regressions (red reproductions for confirmed defects) for flat machined flange normals, full elapsed-time motion at low FPS, stopped/paused/brake actual RPM, and real GLB signed cam/flex alignment.
- [x] Correct generator flat-face shading and rebuild/validate the real asset without changing physical dimensions or motion bindings.
- [x] Give inspection reflections a neutral lower hemisphere; prevent bloom and fit shadow distances to the millimetre-scale model. Verify full/section/bottom views in real UE captures.
- [x] Correct elapsed-time integration in web/UE while keeping bounded character steps, report setpoint separately from actual speed, and expose omitted bearing/contact/load physics honestly.
- [x] Build UE5, run native automation/smoke, full repository tests and appropriate build/format checks; preserve executed evidence and limitations, then review/commit on the existing branch.

Independent read-only mechanical audit found the -1/100 ratio, main part hierarchy and signed flex/cam phase correct in final GLB. Do not alter those correct signs. Input/output bearing rolling and deformable wave-bearing material transport remain omitted; do not replace them with unverified animations. A full physical simulation requires engineering data absent from this educational model.

Validation record: docs/validation-native-engines.md (2026-10-24 reducer section). Dedicated browser checks passed, including disabled storage and exported playback with editor/external origins blocked. Independent review found no blocking issue; preserve this branch and commit the verified work.
