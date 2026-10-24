# VirtualWorld native Unreal project

This source project targets **Unreal Engine 5.8** and the exact glTFRuntime commit
`0b22180d5d5d48b13457b683f4405113b6afd87b` (2026-10-14). It loads the canonical
GLBs at runtime, retaining their scene hierarchy, skins, original clips, textures,
materials, and named morph targets. It needs no VirtualWorld Studio service.

**Native compilation and rendering have not been executed by the export
generator.** A successful export or data preflight is not a native engine pass.
Run the native acceptance checks below on an actual Unreal installation.

## Prepare, build, and play

Install Unreal Engine 5.8 and its platform C++ toolchain through Epic's supported
installation process. Git and Node.js 24 are required for these helper scripts.
Unpack the export into a fresh directory. Keep the entire project together:
`VirtualWorld.uproject`, `Source`, `Config`, `Scripts`, and
`Content/VirtualWorldData/engine-manifest.json` with its `models` directory.

From that directory:

```sh
node Scripts/native.mjs check --data-only
node Scripts/prepare-plugin.mjs
node Scripts/prepare-plugin.mjs --verify
node Scripts/native.mjs build --engine /absolute/path/to/UnrealEngine
node Scripts/native.mjs run --engine /absolute/path/to/UnrealEngine
```

`UE_ROOT` can supply the engine installation root instead of `--engine`.
Windows and macOS are also recognized; pass a quoted installation directory.
The installer fetches only the pinned public GitHub commit into a newly created
`Plugins/glTFRuntime` directory. It refuses an existing destination, including
symlinks, and never upgrades or replaces a checkout. Verification rejects a
different commit, modified tracked files, and untracked source files. The
plugin's complete MIT license and content stay with its checkout.

Alternatively, generate the IDE project files from `VirtualWorld.uproject`,
compile the `VirtualWorldEditor` Development target, then open the project and
press Play. The engine Entry map uses `VirtualWorldGameMode` to create the native
runtime. The startup scene comes from `entrySceneId`. To open another exported
scene directly:

```sh
node Scripts/native.mjs run --engine /absolute/path/to/UnrealEngine --scene little-prince-b612
```

The equivalent native argument is `-VirtualWorldScene=little-prince-b612`.
An explicit startup chapter is playable on a fresh save. Later menu transitions
still enforce chapter prerequisites. Reset returns to that launch chapter.

## Local STEP / STP import

Projects created by the repository's `npm run native:export` command include an
approximately 10 MiB offline CAD helper under `Content/VirtualWorldTools/Cad`.
Run with Node.js 24 or later:

```sh
node Scripts/native.mjs run --engine /absolute/path/to/UE_5.8
# Optional initial file, also useful for repeatable native acceptance:
node Scripts/native.mjs run --engine /absolute/path/to/UE_5.8 --import /absolute/path/to/model.stp
```

Click **Import STEP / STP** or press **O**. Editor-based game runs use the native
file selector. Packaged game builds use a path-entry window because they cannot
depend on the editor's DesktopPlatform module. The launcher supplies `VW_NODE_EXECUTABLE`. The package helper copies the installed
host Node runtime and its LICENSE into the non-UFS tools directory; a directly
launched package uses that bundled runtime without a separately installed Node.
An explicitly supplied `VW_NODE_EXECUTABLE` overrides the bundled path. The
packaging host needs an official Node24+ distribution with its LICENSE present. Nothing downloads
Node, contacts Studio or calls a paid provider. Plain source archives exported
through the generic download API do not contain the CAD helper; create a native
project through the CLI above to enable this optional feature.

The converter runs separately while the current scene remains visible. The
Cancel button, scene changes, shutdown and a 180-second limit stop an import.
Failed conversion keeps the current scene. Successful imports extend the scene
menu, so H-100 and previous imports remain selectable during this run. Imports
are retained under `Saved/VirtualWorld/Imports/<request-id>/converted`: `source/`
holds original STEP bytes, `optimized/` holds the generated GLB, `scene.json` is
the validated SceneSpec, and `manifests/import.json` retains hashes, dimensions,
parser version and glTF validator messages. Imported models are static inspection
assets with their available hierarchy and colors; no motion constraints or
engineering parameters are inferred. **R** frames the imported model again.

A fresh native diagnostic receipt is written to
`Saved/VirtualWorld/import-report.json`. It records the installed scene, actual
native static mesh count and bounds in centimetres. The source/manifest remains
in metres; the engine loader performs the single centimetre conversion.

## Native controls

The left HUD contains clickable actions, chapter choices, tasks and dialogue.
Mechanism scenes use fixed manual exposure, a neutral key/fill lighting rig,
and a weak shadow-free fill that follows the inspection camera. A fixed engine
daylight cubemap supplies metal reflections without capturing the empty Entry
sky. Lighting stays active while paused, running, sectioned or exploded; it has
no exposure adaptation or time-of-day cycle. The cubemap directory is included
in the cook configuration. Main-light shadows retain shape while the fills
keep exposed internal parts readable.

Scroll over the panel to reach additional controls. Scroll over the rendered
scene to zoom. Right-drag or arrow keys orbit the camera; middle-drag pans an inspection view; the mechanism camera
has no polar clamp. Drag starts over the scene, without an initial jump, and the
HUD panel handles its own wheel scrolling. Mouse smoothing is disabled. Q/F rolls the mechanism view. The configured near plane is
0.01 centimetres so the small harmonic model can be inspected close up.

| Experience          | Keyboard                                                        |
| ------------------- | --------------------------------------------------------------- |
| Player movement     | WASD, relative to the camera                                    |
| Nearest interaction | E, within 3 metres; world markers are clickable                 |
| Dialogue choices    | 1–9 and 0; Escape closes the dialogue                           |
| Chapter selection   | HUD buttons; Tab cycles unlocked chapters                       |
| Pause/resume        | P                                                               |
| Reset               | R resets campaign progress, or zeros the harmonic input         |
| Harmonic input      | Space run/stop; +/- changes signed RPM; [ and ] step 15 degrees |
| Inspection          | C section/full housing; X cycles explosion 0–100%               |
| Brake               | I installs/removes it; B powers/releases or cuts power/locks it |
| Subsystems          | HUD hide/show and isolate/unisolate buttons                     |

The Prince is instantiated once from `actorModel`; its editing preview node is
not duplicated. Native skeletal components play the authored Idle/Walk/Interact
clips. The pilot uses its skeletal Idle; the fox uses its rigid node Idle.
Authored node clips honor loop and speed. Plane navigation uses bounds and
native capsule sweeps with a wall slide; when a collider-backed surface ends,
the unsupported step is rejected. Spherical navigation constrains the feet to
the authored radius and transports the player/camera frame along the surface.
These are kinematic native queries, not a claim of physics parity with Rapier.
Prince jumping and airborne gravity are not implemented in this adapter. Space
only operates the harmonic mechanism; it does not make the player jump. Treat
`CHARACTER_JUMP_UNMAPPED` as an unsupported feature, separate from the native
validation status of the implemented surface movement.

Interactions check proximity and required flags before granting progress. Choice
text, tasks, completion, and campaign prerequisites come from scene metadata.
Progress is separate JSON in `Saved/VirtualWorld/progress.json`; fingerprints and
flag reachability reject obsolete or inconsistent saved states. Opening another
chapter does not erase validated progress. Reset clears local campaign progress.

Harmonic motion is an ideal kinematic demonstration: output/input ratio is
`-(ringTeeth - flexTeeth) / flexTeeth`; the two named morph amplitudes are
`cos(2*(input-output))` and `sin(2*(input-output))`. Signed weights are passed to
native `SetMorphTarget` without zero-to-one clamping or percentage scaling.
The flex cup is loaded as a morph-capable skeletal mesh even when its source has
no skin. The power-off brake prevents run/step changes while installed and
unpowered. It does not simulate brake force, torque or stopping distance.

## Coordinate and asset contract

The manifest stays in metres, right-handed Y-up, with xyzw quaternions.
`VW::LoaderConfig()` uses the pinned importer's default basis and `SceneScale=100`.
Positions use that very same `GetMatrix()`. Wrapper matrices use
`Basis.Inverse() * SourceMatrix * Basis`, with source translation scaled once.
Imported geometry is already converted by glTFRuntime; no extra reflection or
negative wrapper scale is applied. The authored player model faces source +Z;
one visual-local orientation correction aligns that frame with native +X movement
while preserving the bottom-centre height normalization.

Canonical files must match their SHA-256, byte count and `models/<sha256>.glb`
path before loading. The importer cannot resolve external files. The data checker
also verifies actor clips, hierarchy references, campaign dependencies and
harmonic target names. Missing render meshes, animation bindings, morph pairs or
import errors produce a persistent HUD error and a native log entry.

## Central harmonic inspection

A CAD binding may specify `inspectionWindowRadius` in original CAD metres together
with `inspectionOpacity`. Its pivot/axis define a coaxial center window. Native
inspection partitions display surfaces with a64-sided prism, retains the opaque
rim with its source materials and ghosts only the center. This adds no caps and
changes no source mesh or physical transmission. Fragments are aggregated by
source material so section compaction cannot recolor the rim. Display copies are
built once per inspection entry, follow the actual moving component, and are
released on full-assembly restoration. The browser uses a radial alpha mask in
transient clones. The source CAD and materials remain unchanged.

The local real-joint profile uses a19mm radius on three documented occluders,
retains the circular spline entirely opaque, and authors202RPM as its motor
setpoint. Fixed flexspline with101:1 circular output produces+2RPM. These are local
profile values; legacy unconfigured scenes keep their authored/default behavior.

## Standalone applications and Windows builds

Package on the target platform with the installed UE5.8 C++ toolchain. The helper
performs build/cook/stage/package/archive; `--output` names the distribution
folder. Distribute the whole archived directory, including the executable/app,
Pak files and non-UFS model/tool files. An exported `.uproject` is source, not a
standalone executable. A packaged player does not need the UE editor, Node or
Studio installed; the optional CAD importer uses the bundled licensed runtime.

macOS, with Xcode selected:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node Scripts/native.mjs package --engine '/Users/Shared/Epic Games/UE_5.8' --configuration Development --output ./Packaged/Mac
```

Windows PowerShell, with UE5.8 and its supported Visual Studio C++ workload and
Windows SDK installed:

```powershell
node Scripts/native.mjs check --data-only
node Scripts/prepare-plugin.mjs
node Scripts/prepare-plugin.mjs --verify
node Scripts/native.mjs package --engine 'C:\Program Files\Epic Games\UE_5.8' --platform Win64 --configuration Development --output 'D:\VirtualWorldBuild'
```

Use `--configuration Shipping` for a distribution configuration after target
validation. The default is Development for diagnostics. Windows packaging runs
on Windows; this helper rejects a Win64 target on macOS rather than claiming a
cross-built `.exe`. Node, pinned plugin, canonical GLBs, tools and required
licenses must remain present during packaging. No runtime binary is downloaded
by the helper. Verify the archived application on each intended target system;
unsigned/notarization, signing and installer distribution are separate release
work. A successful Mac build does not validate a Windows build.

Mac packaged offline import still requires sandbox-compatible file selection and
writable converter storage. Direct playback is verified; the current default
sandbox blocks creating the conversion directory for an absolute-path import.
Keep that distinction when distributing this build.

During CAD playback, the hidden illustrative layer keeps its buffers; opening
it synchronizes to the current physical angle. Visible animated strips reuse
topology/render sections and analytic normals. Paused unchanged geometry is
cached. These changes do not alter physical time,101 reduction or source CAD.

Official references: [Epic packaging](https://dev.epicgames.com/documentation/en-us/unreal-engine/packaging-your-project),
[Epic Visual Studio setup](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-visual-studio-development-environment-for-cplusplus-projects-in-unreal-engine).

## Native acceptance checks

```sh
node Scripts/native.mjs smoke --engine /absolute/path/to/UnrealEngine
node Scripts/native.mjs package --engine /absolute/path/to/UnrealEngine
```

The smoke helper starts the actual Unreal game renderer, loads each exported
scene, checks canonical imports and native collision queries, exercises story
prerequisites/choices/completion, and checks signed morph readback plus mechanism
controls. It does not save gameplay progress. The native executable writes
`Saved/VirtualWorld/smoke-report.json` with a new run ID. Missing engines, missing
plugins, failed assertions, process errors, absent reports or stale reports fail
the command. The helper never manufactures a native report. Do not use NullRHI
for this check.

Native automation test source is also included under the `VirtualWorld` group.
Run it from Unreal's Session Frontend Automation window after compiling. It tests
transform/basis consistency, player facing, signed transmission, saved-flag
reachability, and explicit chapter entry with later prerequisite gates.

The smoke report deliberately records `visualParityVerified: false` and
`keyboardLocomotionVerified: false`. Before distribution, manually verify:

- All three Prince chapters: model textures and animation, facing, keyboard
  navigation, obstacle/terrain edges, complete B612 traversal, readable Chinese
  tasks/dialogue/choices, save/reopen/reset, and chapter gates.
- Harmonic model: signed deformation of the actual vertices throughout a full
  input revolution, reverse output, section/full visibility, all subsystems,
  explosion, brake controls, close-up orbit, and small-part rendering.
- A packaged build on the target platform, including runtime static mesh collision,
  material/shader availability, font fallback and performance.

The HUD currently uses Unreal's engine fonts. Chinese glyph coverage in the
target engine/package is an explicit visual acceptance gate; this source export
does not bundle or certify a CJK font. Add a licensed font with the required glyphs
to the native project if the target package's fallback lacks them.

## Packaging and browser delivery

`DefaultGame.ini` cooks `/Engine/Maps/Entry` and the glTFRuntime plugin materials,
and stages `Content/VirtualWorldData` as loose NonUFS data. Keep that directory
with the packaged application. Do not remove source asset attribution notices.
The build helper produces a desktop project; it does not download an engine or
provision a GPU host.

UE5 browser delivery requires a separately built/hosted Pixel Streaming setup.
Enable Pixel Streaming 2 in the native project and use Epic's frontend and
signalling infrastructure matching UE 5.8. Bind each configured browser URL to
the appropriate process/project and pass `-VirtualWorldScene=<id>` on the native
process when necessary. The export contains no server credentials or cloud
deployment. It does not claim an Unreal WebGL/HTML5 build.

## Remaining limits

Generic interactive node joint controls remain metadata beyond their initial
transform. Prince jumping/airborne gravity, splat rendering and arbitrary authored
light nodes are not implemented.
Static mesh/box/ball collision is implemented; a skinned or morphing mesh collider
fails with a request for authored box/ball proxies. Fog, lighting and PBR appearance
are engine approximations and require visual assessment. glTFRuntime's supported
extensions and platform behavior remain dependency constraints. The native module
and this plugin pin still need a real UE 5.8 compile; a JavaScript preflight cannot
establish C++ or packaged-runtime compatibility.

## Primary implementation references

- [Pinned glTFRuntime source](https://github.com/rdeioris/glTFRuntime/tree/0b22180d5d5d48b13457b683f4405113b6afd87b)
- [Pinned configuration and basis](https://github.com/rdeioris/glTFRuntime/blob/0b22180d5d5d48b13457b683f4405113b6afd87b/Source/glTFRuntime/Public/glTFRuntimeParser.h)
- [Pinned actor and animation sequencing](https://github.com/rdeioris/glTFRuntime/blob/0b22180d5d5d48b13457b683f4405113b6afd87b/Source/glTFRuntime/Private/glTFRuntimeAssetActor.cpp)
- [Pinned skeletal and morph import](https://github.com/rdeioris/glTFRuntime/blob/0b22180d5d5d48b13457b683f4405113b6afd87b/Source/glTFRuntime/Private/glTFRuntimeParserSkeletalMeshes.cpp)
- [glTFRuntime documentation](https://github.com/rdeioris/glTFRuntime-docs)
- [Unreal skeletal component API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USkeletalMeshComponent)
- [Unreal packaging](https://dev.epicgames.com/documentation/en-us/unreal-engine/packaging-your-project)
- [Pixel Streaming 2](https://dev.epicgames.com/documentation/unreal-engine/pixel-streaming-2-overview-in-unreal-engine)
- [Official Pixel Streaming infrastructure](https://github.com/EpicGames/PixelStreamingInfrastructure)
