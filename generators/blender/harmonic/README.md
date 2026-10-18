# H-100 original harmonic-joint showcase

Build from repository root with Node.js 24 and the installed Blender 5.2.2 LTS:

```powershell
& 'E:/Software/Blender Foundation/Blender 5.2/blender.exe' --background --python-exit-code 1 --python generators/blender/harmonic/build.py
node generators/blender/harmonic/finalize.mjs
npx vitest run tests/assets/harmonic.test.ts
```

`recipe.json` declares SI dimensions, axial zones, wave amplitude, gear counts, official references and explicitly named nominal contact exceptions. `assembly.py` contains the original compact geometry; `build.py` measures, audits and exports it. These are fixed Python sources, with no provider calls or generated executable code. The editable `.blend` remains local. `finalize.mjs` retains the full Khronos validator receipt, verifies single-primitive identity-transform meshes, derives paths from the final GLB and emits the split world bundle with descriptive subsystem membership.

The runtime artifact is `assets/optimized/showcase/harmonic-joint.glb`; its exact SHA-256, Blender version, actual part bounds, checks, contact audit and validator receipt are retained in `assets/manifests/showcase/harmonic-joint.json`. `.blend`, its backup and preview PNG are local inspection artifacts, not deliverable vendor binaries.

The assembly is original educational geometry, not commercial internal CAD or a manufacturing drawing. Its custom nominal base/housing diameters are 110/100 mm, height 110 mm, continuous bore 18 mm. The rotor magnet radius is 37.5 mm and stator tooth inner face radius 37.9 mm (0.4 mm radial air gap). The 202-tooth circular spline and 200-tooth cup use illustrative triangular profiles, not production involutes. Independent input bearings and alternating +/-45-degree crossrollers show the support topology.

Torque path: permanent-magnet rotor/yoke → carrier → hollow input shaft → elliptical cam → thin wave bearing → flex cup → diaphragm → output neck/carrier/flange. The stator, rigid spline and output outer race are fixed to the housing. Input and output encoders each have a stationary board/readhead/support and an independently moving code ring. The input encoder support descends from the upper fixed support inside the rotor's open cavity with an actual clearance from the rotating carrier. Drive PCB includes a power stage, bus capacitors, controller and separate power/communication/phase interfaces; its layout is schematic, not a validated circuit. The optional brake has stationary yoke, permanent magnet, release coil/poles and an input-connected friction armature. Its energized release gap and ideal holding state do not establish stopping distance or rated torque. Mounting holes and output screw counterbores are actual cuts.

Obstructing stationary rings have capped section alternatives. Motion roots remain independent siblings: `wave-input`, `flex-motion`, `output-motion`. Flex `WaveCos`/`WaveSin` each have 0.3 mm radial amplitude tapering to zero at the diaphragm; exported default weights are zero and runtime applies the physical rest ellipse. GLB positions and deltas are Y-up metres with identity transforms. Runtime must not double-rotate output via flex parenting.

Nominal BVH surface overlap is checked in full/section configurations at input angles 0, pi/4 and pi/2, including the corresponding flex deformation and output angle. Explicit pairs represent fixed mounting interfaces, same-rotor connections, encoder marks/PCB mounted components, seals and intended gear/bearing contacts. They are not blanket subsystem exceptions. Unexpected pairs fail while retaining the audit in ignored `output/harmonic-build-failure.json`; the staged source GLB is not promoted and the approved optimized GLB/manifest remain unchanged. `npm run test:harmonic-build-failure` verifies that rejection path using real Blender in an isolated fixture. Coplanar boundaries count as contacts. This is a sampled surface audit, not a solid-containment, continuous-contact, tolerance-stack, preload or manufacturing-fit solver. No load, thermal, circuit, fatigue, FEA, hardware or human qualification is claimed; `joint.confirmed` stays false.

Subsystem membership addresses leaf SceneSpec meshes only. Group/parent membership is rejected to prevent hiding a different subsystem through an ancestor; legacy worlds without subsystem metadata are unchanged. Imported hierarchies must expose leaf parts before adding this observation metadata.

## Official references and reconstruction boundary

Accessed 2026-10-18; URLs and download hash are also retained in recipe/manifest.

- [ZeroErr official eRob CAD downloads](https://www.zeroerr.cn/download/eRob.html): downloaded eRob90 V6 ZIP SHA-256 `722c9eca09b3e54b0f6b6b5f3d8fd55bb8d358d631a5f25df20b3851f1de7db4`. Actual STEP is an exterior envelope (90 mm diameter, 79 mm connector-inclusive length); drawing specifies body 75.9 mm and bore 18 mm. It is not an internal reducer assembly. Raw ZIP/STEP/PDF remain in ignored `output/h100-reference/`, not in Git or the player. Its friction damping brake is not relabelled a permanent magnet brake.
- [Harmonic Drive CSG/CSF component manual](https://www.harmonicdrive.net/_hd/content/documents1/CSG-CSF_Component.pdf): real cup, diaphragm, circular-spline and elliptical wave-generator topology. The attempted CSG-20-XXX-2UH STEP URL returned 404, so this build does not claim to contain that vendor CAD.
- [Eyou RHU20L official product](https://eyoubot.com/products/rhu20l-70-n-f) and [Techsoft RJSIIZ official manual](https://www.techsoft-robots.com/upfile/RJSIIZ%E7%B3%BB%E5%88%97%E5%85%B3%E8%8A%82%E6%A8%A1%E7%BB%84%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8CV1.0.pdf): integrated frameless motor, reduction, drive/encoder architecture only. Their ratings and exact internal dimensions are not assigned to H-100.

Optional local visual review:

```powershell
& 'E:/Software/Blender Foundation/Blender 5.2/blender.exe' --background --python-exit-code 1 --python generators/blender/harmonic/render.py
```

This produces `assets/source/showcase/harmonic/section-preview.png` using the actual saved Blender scene and the same section alternatives. It does not modify the delivered GLB or world.

### Output-down layout correction (2026-10-19)

Published geometry is Y-up with the reducer/output at the bottom, then the frameless motor, optional brake, and drive at the top. Actual positions and axial-zone bounds are retained in the manifest. The authored primitive frame is converted with the proper rotation `(x,y,z) -> (y,x,0.110-z)` after baking transforms; drive parts retain their upward component face at `z+0.0922`. The flex sine delta reverses sign to retain phase alignment with a positive world-Y input. No negative node scale or camera inversion substitutes for this geometry change.

The top fixed mounting rim is open (90 mm ID); the driver has its own support ring independent of the optional brake. The motor-side shell stops at Y=42 mm. Four fixed pillars expose the reducer and four fixed bridges support its output outer race. Matching section variants omit the cutaway-quadrant supports. Eight actual boolean inspection windows pierce the rotating output flange and carrier between mounting holes, preserving hub/rim and cup diaphragm. Original educational topology does not prove production strength or sealing.

The [official Eyou exploded diagram](https://eyoubot.com/blog/harmonic-drive-systems-robot-joints), inspected directly, places the drive, brake, motor and reducer along the rear-to-output axis. The already-downloaded [ZeroErr official exterior STEP](https://www.zeroerr.cn/download/eRob.html) remains an envelope reference only; internal vendor CAD was not obtained. Raw vendor downloads and the inspected diagram remain ignored under `output/h100-reference/`.
