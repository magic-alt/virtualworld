# H-100 original harmonic-joint showcase

Build from repository root with Node.js 24 and the installed Blender 5.2.2 LTS:

```powershell
& 'E:/Software/Blender Foundation/Blender 5.2/blender.exe' --background --python-exit-code 1 --python generators/blender/harmonic/build.py
node generators/blender/harmonic/finalize.mjs
npx vitest run tests/assets/harmonic.test.ts
```

`recipe.json` declares the approved SI dimensions, wave amplitude, gear counts and explicit nominal contact exceptions. `build.py` is fixed, original Python; no provider calls, downloaded meshes, generated executable code or paid jobs. It creates the editable local `assets/source/showcase/harmonic/harmonic-joint.blend` and the portable GLB. `finalize.mjs` runs Khronos glTF Validator, retains its complete issues/warnings, verifies one primitive and identity transforms per selectable part, derives numeric paths from the finalized GLB hierarchy, and generates the split world bundle. No decimation is applied to the thin gear/wave geometry.

The runtime artifact is `assets/optimized/showcase/harmonic-joint.glb`; its exact SHA-256, Blender version, actual part bounds, checks, contact audit and validator receipt are retained in `assets/manifests/showcase/harmonic-joint.json`. `.blend`, its backup and preview PNG are local inspection artifacts, not deliverable vendor binaries.

The assembly is original educational geometry, not a reverse-engineered commercial product or a manufacturing drawing. Overall nominal diameters are 215 mm base and 180 mm housing, total height 165 mm, continuous bore 20 mm. The rotor magnet outside radius is 60.5 mm, stator tooth inside surface radius 61 mm (0.5 mm nominal radial motor air gap). Input support uses independent upper and lower bearings. The circular spline has 202 explicitly modeled tooth peaks; the flex cup has 200. Tooth flanks are illustrative triangular profiles, not production involutes. Crossroller rolling elements alternate +45/-45 degrees in a simplified race section.

Torque path: rotor yoke and permanent magnets → bottom carrier → hollow input shaft → elliptical cam → wave bearing → flex cup tooth engagement → upper cup diaphragm → output neck → bearing carrier and recessed-bolt output flange. Fixed parts are located by base/lower bearing seat, housing/stator fit sleeve, upper input bearing support plate, circular spline housing fit, crossroller outer housing fit and upper retention ring. Coil formers locate the modeled winding packs. Encoder board is seated on the lower bearing seat; its separate code ring follows the input. Mounting holes and recessed output screw pockets are actual Boolean cuts.

Only stationary obstructing parts are duplicated as full and capped section alternatives; all hidden alternatives remain selectable serialized nodes. Motion roots are independent sibling groups: `wave-input`, `flex-motion`, `output-motion`. The mesh `harmonic-flex-cup` contains `WaveCos` and `WaveSin`, each with 0.5 mm radial amplitude tapering to zero at the diaphragm. Their default weights are zero; runtime drives cos/sin of twice input angle relative to output. All GLB mesh positions and morph deltas are already Y-up, in metres, with identity node transforms. Runtime must not rotate the output group again through parenting under the flex group.

Nominal BVH surface overlap is checked in both full and section configurations. Only explicitly named contact pairs are allowed; unexpected pairs fail the build. Coplanar mating surfaces count as contacts. This checks nominal triangle intersections and specific dimensional clearances; it does not prove absence of solid containment, continuous-motion interference, tolerance accumulation or production assembly fit. No torque, load, stress, thermal, insulation, lubrication, fatigue, life, FEA, hardware or human confirmation is claimed. `joint.confirmed` remains false.

Optional local visual review:

```powershell
& 'E:/Software/Blender Foundation/Blender 5.2/blender.exe' --background --python-exit-code 1 --python generators/blender/harmonic/render.py
```

This produces `assets/source/showcase/harmonic/section-preview.png` using the actual saved Blender scene and the same section alternatives. It does not modify the delivered GLB or world.
