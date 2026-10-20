# Little Prince Blender recipes

## Full Blender build

Run from the repository root with Node.js 24 and Blender 5.2.2 LTS:

```powershell
$env:BLENDER_PATH = 'E:/Software/Blender Foundation/Blender 5.2/blender.exe'
node generators/blender/prince/build.mjs
npx vitest run tests/assets/prince.test.ts
```

`build.py` is the original fixed offline source. It uses seed 612, metre units, a 6 m B-612 sphere and 22 m planar terrain. Its desert output supplies the central 22 m × 22 m encounter area, including the aircraft; the final desert is expanded by the separate Node.js step below. The recipe builds each role and landscape, embeds pigment and normal textures, retains skeletal/transform clips, triangulates export meshes and writes editable local `.blend` snapshots. No paid generation or downloaded models are used. The glTF exporter converts Z-up authoring to Y-up runtime coordinates.

`build.mjs` invokes Blender with `--python-exit-code 1`, so Python failures stop the build. It removes unused tangent semantics only from primitives without a normal texture, retains normal-map tangents, validates the retained GLBs and records hashes, bytes, geometry/clip counts and validator messages. Severity-2 unused-accessor notices may remain; they are distinct from errors and warnings. It then calls `buildDesertHorizon()` from `extend-desert.ts`, which validates the expanded desert and updates its final receipt, followed by `bundles.mjs`, which writes the three scene/story/assets bundles and campaign manifest.

For an existing full build, `node generators/blender/prince/build.mjs b612` rebuilds that target and revalidates all retained assets. The target list is part of the deterministic build input; use the full command for a clean checkout. Render inspection uses `render.py`; PNGs, logs, `.blend` and backups remain local under `assets/source/showcase/prince/` and are ignored. Commit the fixed source, final runtime GLBs, receipts and world JSONs.

## Desert extension with Node.js

`extend-desert.ts` deterministically appends a sand mesh around the original encounter area, producing a 220 m × 220 m landscape spanning X/Z −110 to +110 m. It preserves the original centre, aircraft, source geometry buffers and existing attribute definitions. The new mesh reuses the sand material and matches the source perimeter's positions, normals, UVs and tangents at the join. Dunes farther from the centre blend into broader terrain.

Version 2 retains every dense ring from 11 to 27 m, including the 11.5 m seam ring, then uses 4 m radial spacing at 31, 35, …, 107 m plus the final 110 m ring. All 39 rings retain 512 vertices. The horizon contains 38,912 triangles, 62% fewer than version 1's 102,400; the complete desert contains 106,536 triangles. This changes the broad outer terrain's sampling, while preserving the original centre, transition area and movement bounds. It does not establish a hardware frame-rate result.

The desert scene declares a nominal 200 m × 200 m playable region through `navigation.bounds`, with X/Z −100 to +100 m. The remaining 10 m of sand on each side forms an outer apron beyond the movement boundary. Runtime movement respects the character capsule's clearance inside those bounds; triangle collisions use the expanded visible terrain.

To extend an existing retained original desert without rebuilding the Blender assets, run this command from the repository root with Node.js 24:

```sh
node generators/blender/prince/extend-desert.ts
```

The command reads `assets/optimized/showcase/prince-desert.glb`, extends and validates it, updates its manifest receipt, and regenerates the chapter bundles. The other retained chapter assets and manifests must already be present. The pure `extendDesert(input)` function returns input bytes unchanged when the GLB carries the version-2 desert-horizon marker, so rerunning the CLI on the current expanded desert retains identical GLB bytes while refreshing the receipt and bundles. Older horizon versions are rejected: regenerate from the original 22 m GLB, rather than appending to a version-1 expansion. The retained original is available at baseline commit `e2def020dba9a96067a37069517211dffacbbaf1`, or through a fresh Blender desert build.

The desert fix and version-2 refinement used this Node.js postprocessing path on the retained original runtime asset. Blender was not executed for this task; the full build command above documents the regeneration path.

## Characters and navigation

Character/pilot clips are in-place `Idle`, `Walk`, `Interact`, feet at zero facing +Z. The fox uses an independent `Idle` breathing/ear/tail transform clip. Runtime instances have independent skeletons, animation mixers and material textures. Landscape meshes are joined by material to limit draw calls. B-612 uses an explicit radius-6 sphere plus volcano/globe collision proxies; the other landscapes use world-space triangle meshes.

The player controls the Little Prince in all three chapters. In the desert, `actor.nodeId` links the playable Prince to the authored `prince` preview at the spawn position. Entering exploration hides that preview while the controlled instance is visible; stopping restores it with the current isolation state. The pilot is a separately authored NPC beside the aircraft, visible before and during exploration with its own idle animation. The desert dialogue and interaction anchors follow that arrangement.

## Story scope

Story source, original paraphrase and adaptation scope are in [ATTRIBUTION.md](../../../worlds/little-prince/ATTRIBUTION.md). The selected chapters cover the desert encounter, tending B-612, then the rose garden/fox and reflection. Only the final dependency-guarded interaction completes each chapter. This is stylized detailed game art; smoke is authored static geometry, and the project does not claim photoreal humans or a complete-book recreation.
