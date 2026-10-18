# Blender showcases implementation plan

Approved brief: three original Little Prince chapters (desert, B-612, Earth rose garden/fox), recognizable original shapes with detailed PBR materials, third-person exploration including spherical navigation, and a parametrically designed harmonic joint. Desktop Edge/GTX 1660 SUPER is the measured target. Use installed Blender 5.2.2 LTS at E:/Software/Blender Foundation/Blender 5.2/blender.exe. No paid generation required.

## Shared contracts

- SceneSpec v1 remains compatible. Optional navigation: `{kind:'plane'}` or `{kind:'sphere',center:[x,y,z],radius:number}`. Sphere radius defaults are not inferred from geometry; B-612 radius is 6m, and sphere transforms remain uniform.
- Optional actor: `{assetId,height,clips:{idle,walk,interact}}`; GLB root feet at zero, faces +Z, in-place clips `Idle`, `Walk`, `Interact`. Default actor remains legacy character. Optional node animation: `{clip,loop?,speed?}`.
- Optional campaign: `{id,chapterId,index}`. Manifest: `{version:1,id,title,description,chapters:[{id,title,directory,requires?:string[]}]}`. Directory paths relative to campaign root. Chapter IDs: little-prince-desert, little-prince-b612, little-prince-earth. Root worlds/little-prince/campaign.json; chapter documents in chapters/desert, chapters/b612, chapters/earth. Scene tasks remain locally reachable; campaign unlock checks completed prerequisite chapters.
- Optional mechanism: `{kind:'harmonic',waveNodeId,flexNodeId,outputNodeId,fixedNodeIds,flexTeeth,ringTeeth,cosMorph,sinMorph,fullHousingIds,sectionHousingIds,dimensions:{baseDiameter,housingDiameter,totalHeight,boreDiameter}}`. All referenced IDs are SceneSpec nodes. Flex mesh morph targets named WaveCos and WaveSin; radial deformation amplitude 0.5mm authored in GLB. Input Y rotation theta, flex/output rotation `-theta/100`; morph phase is relative input-to-flex rotation. Fixed parts stay fixed.
- Collider shape adds `mesh` (retains size tuple): static triangle mesh collected from loaded object's world geometry. Existing box/ball meanings unchanged.
- Asset URLs `/assets/optimized/showcase/*.glb`; original .blend files in assets/source/showcase (local binary artifacts), editable fixed Python recipes committed. Runtime GLBs and receipts are explicitly whitelisted and committed, embedded textures only.
- Industrial default design: base215mm, housing180mm, height165mm, bore20mm; 200/202 teeth, fixed circular spline and wave-generator input. No fabricated rated torque, stress or human confirmation.

## Tasks

1. Schema/contracts and regression tests (root): compatible optional fields, validation of all IDs/gears/campaign/navigation, no mutation of existing saved projects.
2. Little Prince assets (world asset implementer): deterministic Blender recipes, real local Blender build, original actor/fox/landscapes/PBR/animation, three split scene bundles and campaign; chapter attribution and build reports. Own only showcase world recipes, corresponding assets/worlds, and asset tests.
3. Harmonic joint assets (engineering implementer): deterministic Blender geometry + named parts/morphs, actual GLB/.blend generation, assembly/section variants, exact units and parametric engineering checks, split demo-harmonic-joint bundle. Own only joint recipes/assets/world and corresponding tests.
4. Runtime (runtime implementer): shared asset animation, separate spherical controller/camera, mesh collision, harmonic kinematics + section switch + diagnostics; tests covering sphere poles/jump/normal, ratio/fixed components, animation/disposal.
5. Integration (root): campaign discovery/API/save/unlock/static export, new default showcases without losing legacy IDs, chapter/engineering UI, build/validation CLI orchestration and receipts.
6. Review and qualify (root + independent reviewer): actual Blender builds, validator, legacy+new tests, screenshots/actual keyboard workflows and standalone campaign, 10s desktop profiles; average>=55FPS/P95<=25ms target at1280x720 DPR1, <750k visible triangles/<150 draws target. Record actual outcome and limitations. Push feature branch, create real PR, merge tested head, sync main.

## Progress ledger

- Setup: branch feat/blender-prince-harmonic-scenes created from freshly fetched origin/main (b803218).
- Ruling: work in the user's existing directory on the requested new branch rather than creating a nested checkout; avoids parent-workspace npm links and keeps the preview target concrete. Cost if wrong: can relocate to worktree later.
- Pre-flight: assets and runtime share schema/clip/morph names above; root owns protocol changes. Asset tasks have disjoint outputs/scripts. Runtime owns engine/interaction/asset-runtime; root owns API/UI/export. Concurrent workers must not commit shared changes; root stages reviewed deliverables.
- Existing local dev process stopped before branch edits. No user assets/data are removed.
- Implemented: optional validated schema, nested campaign catalog/API, separate story saves and derived chapter unlock, session fallback, editor chapter/section/RPM controls, complete offline campaign export with content-hash asset deduplication.
- Actual local Blender builds produced six Prince GLBs and one harmonic assembly; final Validator errors/warnings are zero. Recipes, runtime assets, receipts and split worlds are retained; local Blender/PNG artifacts are ignored.
- Independent review caught the changing-up OrbitControls cache bug; real 360-degree OrbitControls regression failed before fix and passed after refreshing the pinned r180 basis. Additional fixes cover early completion, radius, ancestry, metadata integrity, skeleton textures and planar hotspot coordinates.
- Qualification: 99 unit/integration tests passed; existing browser 25 checks and showcase 26 checks passed. Full 1280x720/DPR1 static-player profiles each ran 10s, ~75FPS/P95~13.4ms, maximum115draws/290146triangles. Static API was stopped and external/API requests blocked for exported chapter tests. Actual keyboard movement/jump is separate from explicitly recorded story fixture teleports. Detailed evidence and limitations: docs/blender-showcases.md.
