# VirtualWorld Unity 6 runtime

This archive contains an importer and native Unity C# runtime for the authored
Little Prince chapters and harmonic-joint inspection experience. Models render
through Unity's own imported meshes, materials, animation and physics queries.
The packaged player has no dependency on the Studio service or an external model URL.

## Import and play

1. Use a Unity 6 project with the built-in render pipeline. Install
   `com.unity.cloud.gltfast` **6.14.1** through Package Manager. Keep the standard
   animation, audio, physics, IMGUI, text rendering, legacy input and JSON
   serialization modules enabled.
2. Copy the complete archive into a fresh directory beneath `Assets/`, for example
   `Assets/VirtualWorldExport`. Wait for script compilation and glTFast imports.
3. Prepare the bundled Chinese UI font from the project directory:
   `node Assets/VirtualWorldExport/Scripts/prepare-font.mjs --project .`.
   A project created by the native project command also has this script at
   `Scripts/prepare-font.mjs`. The script installs the pinned font and license in
   `Assets/VirtualWorldFonts`; it refuses to overwrite an existing directory.
4. Select **Tools > VirtualWorld > Import manifest**, then select
   `engine-manifest.json`. Import creates a fresh `VirtualWorld-Native` directory
   beside the manifest; existing scenes and prefabs are not overwritten.
5. Open `VirtualWorld-Native/Scenes/<scene-id>.unity` and press Play. Each scene is
   runnable and references `Catalog.asset`; the manifest entry scene is first in
   the generated build order. The importer also retains editable node prefabs,
   original IDs and source JSON.

If a different GLB importer conflicts with glTFast, import fails before scene
creation. Imported named clips and actor-only models are checked. A lost harmonic
morph binding is an error, rather than a silent static mechanism.

Official import documentation:
https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@6.14/manual/ImportEditor.html

## Controls

- **Little Prince:** WASD/arrows or on-screen buttons move; Space jumps; E or a
  nearby hotspot interacts. Right-drag orbits; the wheel zooms. The three chapters
  retain task prerequisites, dialogue, choices, completion and gated chapter
  selection. The authored Prince preview is hidden while one runtime actor plays.
- **B612:** radial up, tangent movement and native capsule/sphere collision queries
  follow the spherical world. The camera transports around the planet and hides
  far-side interaction labels.
- **Harmonic:** left/right-drag orbits without a polar lock; middle-drag pans;
  wheel zooms. The panel offers signed speed, start/stop, step/reset, power-off
  brake, cutaway, explosion, subsystem visibility/isolation, focus and named views.
  Signed `WaveCos`/`WaveSin` morph weights drive the flexible cup.
- **Escape** closes dialogue or toggles pause. Reset journey clears separate
  engine-local story/campaign saves. Presentation and player state never rewrite
  SceneSpec or an authored prefab.

The player uses the classic Unity input API and IMGUI; choose **Input Manager
(Old)** or **Both** if changing Active Input Handling in an existing project.

## Reproducible Chinese UI font

The default font is `Assets/VirtualWorldFonts/NotoSansCJKsc-Regular.otf` from
[Noto Sans CJK Sans2.004](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004),
release commit `523d033d6cb47f4a80c58a35753646f5c3608a78`. Its SHA-256 is
`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.
The helper downloads only that pinned official file, verifies its checksum,
and copies the upstream SIL Open Font License with a provenance record.
Large font bytes are downloaded into the generated project, not stored in the
runtime source package. Keep `OFL.txt` with the font; batch builds also write
`Font-LICENSE.txt` beside the player output and copy any exported `LICENSES.txt`,
`ATTRIBUTION.txt` and `THIRD_PARTY_NOTICES.md` into that build directory.

For an offline preparation, download the same pinned file on a connected machine,
then run `node Scripts/prepare-font.mjs --font-source /path/to/NotoSansCJKsc-Regular.otf`.
The same checksum is required. `node Scripts/prepare-font.mjs --verify` checks an
existing installation without downloading or modifying it. When using the script
from the archive's nested Assets directory, also pass `--project PROJECT`.

Import stores the font in the catalog and binds it to every newly generated scene.
Each batch reimport resolves the same asset path, so font selection survives a
rebuild. An alternative licensed `.otf` or `.ttf` inside Assets can be selected
with `-virtualWorldFont Assets/path/to/font.otf` on any batch method. The importer
embeds the font data, uses Dynamic character rendering, and checks all authored
scene/task/dialogue/choice/subsystem text plus runtime UI symbols. Missing fonts
or required glyphs stop import/validation/build with an actionable error, including
WebGL; operating-system fallback is not required. Changing only an older generated
scene's font field does not change the font selected for a fresh batch import.

## Batch import, native validation and build

Pass the absolute path of the manifest already copied inside the project:

```sh
Unity -batchmode -quit -projectPath PROJECT \
  -executeMethod VirtualWorld.Editor.VirtualWorldImporter.ImportBatch \
  -virtualWorldManifest PROJECT/Assets/VirtualWorldExport/engine-manifest.json

Unity -batchmode -quit -projectPath PROJECT \
  -executeMethod VirtualWorld.Editor.VirtualWorldImporter.ValidateBatch \
  -virtualWorldManifest PROJECT/Assets/VirtualWorldExport/engine-manifest.json

Unity -batchmode -quit -projectPath PROJECT -buildTarget WebGL \
  -executeMethod VirtualWorld.Editor.VirtualWorldImporter.BuildBatch \
  -virtualWorldManifest PROJECT/Assets/VirtualWorldExport/engine-manifest.json \
  -virtualWorldBuildTarget WebGL -virtualWorldBuildPath NEW_BUILD_DIRECTORY
```

Build targets: `WebGL`, `StandaloneLinux64`, `StandaloneWindows64`,
`StandaloneOSX`. Install the corresponding Unity build module. Pass a fresh
directory as `-virtualWorldBuildPath` for every target. Windows writes
`VirtualWorld.exe`, Linux `VirtualWorld.x86_64`, and macOS `VirtualWorld.app`
inside that directory; WebGL uses the directory itself. A build refuses an
existing directory, including an empty one, so executable siblings cannot
overwrite prior builds. Each batch operation also imports into a fresh generated
asset directory and preserves previous output.

`ValidateBatch` runs in the actual Unity Editor. It checks node IDs, transformed
hierarchy, geometry, radius units, actor/NPC clips, native morph baking at positive
and negative weights, motion/brake rules, story prerequisites, forged saves,
save/reset, and separation of authored and transient state. It writes
`native-validation.json` only after these checks pass. `BuildBatch` runs those
checks before invoking `BuildPipeline.BuildPlayer` and fails if the build fails.
This is an import/core smoke gate; it does not replace play-mode navigation and
visual acceptance.

## Web entry

A hosted Unity Web build accepts `?sceneId=<id>` through `Application.absoluteURL`.
Only IDs included in its catalog are accepted; unknown IDs show a persistent
error. Each `.unity` scene also has its own explicit initial scene ID. An explicit
entry can start directly at the exported chapter; later chapter-menu transitions
honor campaign prerequisites. Chapter selection resume is opt-in via
`resumeLastChapter`, while story progress always resumes separately.

## Coordinate and fidelity contract

Source dimensions are metres, Y-up, radians. Wrappers reflect source X once:
position `(-x,y,z)`, quaternion `(x,-y,-z,w)`. glTFast supplies matching geometry
conversion, so no second negative scale is applied. Canonical Y-axis mechanism
angles are reflected at the native transform boundary. Morph weights use each
native blend-shape frame's unit weight and preserve the negative half-cycle.

The native controller uses Unity collision queries, not Rapier; contact behavior
and step climbing are not guaranteed to match the browser solver. Imported mesh
colliders and mechanical picking geometry are static, including initially baked
skinned/deformed meshes. Cutaway/explosion/subsystem state controls visibility,
but these inspection colliders do not follow flex deformation. Ambient/fog and
glTF PBR appearance use the Unity pipeline and require visual review. Generic
non-harmonic joint oscillation, splat rendering and a full native editing interface
are outside this runtime. Consult `compatibility.json` for authored limitations.

The runtime source and export checks do not certify native compilation. Unity
Editor import, native smoke/build, all three chapter journeys, signed mechanism
motion, small-scale camera clipping and platform performance must be executed in
the installed engine before claiming a validated native deliverable.
