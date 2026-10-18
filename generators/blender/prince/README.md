# Little Prince Blender recipes

Run from the repository root with Node.js 24 and Blender 5.2.2 LTS:

```powershell
$env:BLENDER_PATH = 'E:/Software/Blender Foundation/Blender 5.2/blender.exe'
node generators/blender/prince/build.mjs
npx vitest run tests/assets/prince.test.ts
```

`build.py` is the original fixed offline source. It uses seed 612, metre units, a 6 m B-612 sphere and 22 m planar terrain. The recipe builds each role and landscape, embeds pigment and normal textures, retains skeletal/transform clips, triangulates export meshes and writes editable local `.blend` snapshots. No paid generation or downloaded models are used. The glTF exporter converts Z-up authoring to Y-up runtime coordinates.

`build.mjs` invokes Blender with `--python-exit-code 1`, so Python failures stop the build. It removes unused tangent semantics only from primitives without a normal texture, retains normal-map tangents, validates the final GLB and records final hashes, bytes, geometry/clip counts and all validator messages. Severity-2 unused-accessor notices may remain; they are distinct from errors and warnings. `bundles.mjs` writes the three validated scene/story/assets bundles and campaign manifest.

For an existing full build, `node generators/blender/prince/build.mjs b612` rebuilds that target and revalidates all retained assets. The target list is part of the deterministic build input; use the full command for a clean checkout. Render inspection uses `render.py`; PNGs, logs, `.blend` and backups remain local under `assets/source/showcase/prince/` and are ignored. Commit the fixed source, final runtime GLBs, receipts and world JSONs.

Character/pilot clips are in-place `Idle`, `Walk`, `Interact`, feet at zero facing +Z. The fox uses an independent `Idle` breathing/ear/tail transform clip. Runtime instances have independent skeletons, animation mixers and material textures. Landscape meshes are joined by material to limit draw calls. B-612 uses an explicit radius-6 sphere plus volcano/globe collision proxies; the other landscapes use world-space triangle meshes.

Story source, original paraphrase and adaptation scope are in [ATTRIBUTION.md](../../../worlds/little-prince/ATTRIBUTION.md). The selected chapters cover the desert encounter, tending B-612, then the rose garden/fox and reflection. Only the final dependency-guarded interaction completes each chapter. This is stylized detailed game art; smoke is authored static geometry, and the project does not claim photoreal humans or a complete-book recreation.
