# H-100 official-reference exterior reconstruction

The runtime geometry is original parametric work, not redistributed commercial CAD. The current exterior uses the official ZeroErr eRob90 V6 STEP, dimensioned drawing and product photographs as references. Vendor STEP/ZIP/PDF/images remain ignored in `output/h100-reference/`. Internal parts, axial packing and the optional permanent-magnet brake are educational simulations, not vendor internal CAD or manufacturing qualification.

## Build and inspection

From repository root, Node.js 24 and Blender 5.2.2 LTS:

```powershell
& 'E:/Software/Blender Foundation/Blender 5.2/blender.exe' --background --python-exit-code 1 --python generators/blender/harmonic/build.py
node generators/blender/harmonic/finalize.mjs
npx prettier --write worlds/demo-harmonic-joint/scene.json
npx vitest run tests/assets/harmonic.test.ts tests/engine/mechanism.test.ts
```

`assembly.py` authors the internal topology; `build.py` bakes transforms/shape keys, converts the axial frame, measures and audits; `exterior.py` creates the final product exterior in Blender Z-up metres. These are fixed source files, never generated executable proposals. `finalize.mjs` validates the final GLB, verifies identity transforms and single-primitive meshes, derives actual serialized paths and emits the split world bundle.

The source `.blend` stays local. Runtime GLB and JSON validator/audit receipt are retained separately under `assets/optimized/` and `assets/manifests/`. Export first writes a staged GLB; unexpected contacts retain a failed audit in ignored `output/harmonic-build-failure.json` and do not replace the approved model/manifest. The rejection fixture copies all generator modules including `exterior.py`.

## Geometry and explicit assumptions

- Official reference envelope: Ø90 mm × 75.9 mm body, 79 mm including rear connectors, Ø18 mm bore. The inspected STEP contains the exterior envelope rather than a usable internal reducer assembly.
- H-100 reconstructed body: scaled exterior proportion 100/90, Ø100 mm × 84.333 mm body, approximately 88.111 mm including socket projections. The bore remains Ø18 mm instead of being scaled. Thin decorative seam lands reach Ø100.24 mm; the nominal body remains Ø100 mm.
- Official bolt-circle proportions are scaled: rotating output face Ø77.778 mm, 12 mounting holes on Ø68.889 mm, 16 recessed hex socket heads on Ø62.778 mm. The separate fixed front ring has 12 mounting holes and 12 recessed socket heads on Ø93.333 mm. Its face lies behind the rotating flange, not over it.
- Silver motor barrel, black annular reducer case, stepped output flange/carrier, rear skirt, protected interface plate and hollow cable collar replace the former projecting rear halo, exposed PCB and artificial eight inspection windows. The case surrounds the reducer and leaves the moving output face free. Section mode cuts the matching quarter of case, plates, supports and fixed screws.
- Rear power socket has two round contact cavities and a latch; CAN has two three-position cavities; EtherCAT has two four-position cavities. I/O and battery are separate connectors. The interface layout is original, informed by the official XT30/JST dimensions rather than an electrically validated pinout. Sockets retain dielectric floors; contacts penetrate those floors. Rear plate openings, bolt bores and hex recesses are actual geometry.
- Bottom to top remains reducer/output → frameless motor → optional PM brake → drive. Original internal axial coordinates are compressed by 0.72 while radial dimensions, 18 mm bore, 0.4 mm motor air gap, 200/202 teeth and 0.3 mm flex wave amplitude remain unchanged. This packing is not a vendor internal measurement.
- The proper frame rotation `(x,y,z) -> (y,x,(0.110-z)*0.72)` is baked into non-drive geometry. Drive components keep their upward face at `(z+0.0922)*0.72`. Shape keys and mounting-hole records follow the same frames. The flex sine delta reverses sign so the ellipse follows the cam for arbitrary signed input phases. No negative node scale substitutes for the transform.
- The authored default camera now looks toward the output face; generic mechanism fitting respects that authored direction and handles vertical defaults with a nonparallel up basis. Full and section models share the runtime/controls with standalone exports.

Smooth-by-angle normals preserve sharp machined edges while smoothing cylindrical walls. Micro bevels on tiny winding/encoder markers were removed; they remain actual geometry. This reduces redundant vertex normals and asset size without removing teeth, bearings or windings.

## Official references actually accessed

- [ZeroErr model/download page](https://www.zeroerr.cn/download/eRob.html): eRob90 V6 EtherCAT ZIP downloaded again on 2026-10-19, 11,790,037 bytes, SHA-256 `722c9eca09b3e54b0f6b6b5f3d8fd55bb8d358d631a5f25df20b3851f1de7db4`, matching the previously inspected STEP/drawing. The CAN V6 ZIP was also downloaded (10,671,803 bytes, SHA-256 `29562717f4aa5e8751b65b325d16db61e110c11f6172b2175d1cd8d60f66580e`).
- [Official eRob90 product photographs and architecture](https://www.zeroerr.cn/preview/erob90i_zh.html): front flange, silver barrel, dark reducer band and rear interfaces were inspected directly. Its friction brake is not relabelled as a permanent-magnet brake.
- [Official XT30 archive](https://www.zeroerr.cn/d/file/20231010/XT30U-F%28DC48V%29.zip): 382,106 bytes, SHA-256 `43b7248bef22acd9885a35a8c18131ecebaab903a19ed1f2b0c5dc129b377a33`; actual STEP parsed by OCCT, envelope 5.2 × 12.4 × 10.2 mm.
- [Official GHR-04V-S archive](https://www.zeroerr.cn/d/file/20231010/GHR-04V-S%28EtherCAT%29.zip): 491,555 bytes, SHA-256 `4b2f4b2993aca5ee57faabaacb661ee53d22a81c91b92924c865d163db72feba`; actual STEP parsed by OCCT, envelope 6.25 × 5.7 × 4.142 mm. These are mating connector references, not claims that the reconstructed onboard sockets are exact vendor CAD.
- [Harmonic Drive CSG/CSF manual](https://www.harmonicdrive.net/_hd/content/documents1/CSG-CSF_Component.pdf): cup, diaphragm, circular spline and elliptical wave-generator topology. The earlier component STEP request returned404; no downloaded internal CSG assembly is claimed.
- [Eyou official exploded diagram](https://eyoubot.com/blog/harmonic-drive-systems-robot-joints) and [Techsoft architecture manual](https://www.techsoft-robots.com/upfile/RJSIIZ%E7%B3%BB%E5%88%97%E5%85%B3%E8%8A%82%E6%A8%A1%E7%BB%84%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8CV1.0.pdf): integration topology only; ratings are not transferred to H-100.

## Verification boundary

Actual final-GLB checks cover envelope, independent mesh paths, teeth, morph amplitudes/phases, full-depth bore rays, mounting bores, connector floors and component order. Six Blender BVH samples cover full/section at input0,π/4,π/2 including deformation. Named interfaces in the recipe and fixed exterior source are explicit contact pairs, not whole-subsystem exemptions. This is triangle-surface sampling, not solid containment, continuous contact, tolerances, strength, preload, circuit or brake qualification. All engineering confirmation stays false.

Optional `render.py` produces a local Blender preview. Browser screenshots and raw receipts under `output/playwright/h100/` and `output/playwright/showcases/` are the acceptance evidence for the delivered frontend; no physical hardware, FEA, real mobile GPU or live paid provider validation is claimed.
