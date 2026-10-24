# Engine exports

Studio's **导出目标** selector provides four archive targets. The initial target is
**网页** and the existing **导出网页** action is preserved. Native downloads include
the target in their filenames and direct users to `compatibility.json`.

| Target                            | Deliverable                                                                                         | How to use it                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (default)                     | Existing standalone browser player, `scene.json`, assets and optional campaign chapters             | Build the player with `npm run build`, extract the archive and serve it over HTTP.                                                                                                                              |
| Godot 4                           | `project.godot`, `main.tscn`, native importer, canonical GLBs, packaged raw GLB bytes and manifests | Open the extracted project in Godot. Run `main.tscn`; the requested current scene is the entry scene.                                                                                                           |
| Unity 6                           | C# runtime, Editor importer, runnable scene/prefab generation, canonical GLBs and manifests         | Install `com.unity.cloud.gltfast` **6.14.1** in an existing project, or generate a fresh source project with `npm run native:export -- --target unity --scene ID --out FRESH_DIRECTORY`. See `README-Unity.md`. |
| Unreal 5.x (5.4+ source baseline) | C++ runtime, `.uproject`, fixed glTFRuntime installer, canonical GLBs and manifests                 | Generate with target `unreal`, or use `npm run unreal:prepare -- --out FRESH_DIRECTORY` for the two-project local acceptance kit. Installed-engine discovery and actual compilation remain separate checks.     |

Native archives do not require `dist/player` or any player build. Unity and Unreal
include native gameplay source for the built-in scenes; actual native compilation,
rendering and play acceptance remain required. Godot retains its scene-interchange
scope. See [native runtime setup](native-engine-runtimes.md) and the
[current validation record](validation-native-engines.md).

## Protocol and archive contract

`POST /api/export` accepts `{ "scene": <SceneSpec>, "target": "web" | "unity" |
"unreal" | "godot" }`. Omitting `target` retains web behavior. Other values, including null,
are rejected with HTTP 400. The same access policy, export admission gate,
campaign validation and disconnect cancellation apply to all targets.

Each archive retains relocated SceneSpec JSON, original validated asset bytes,
`LICENSES.txt`, available `THIRD_PARTY_NOTICES.md` and campaign attribution.
Campaign exports retain every chapter, in campaign order, while the native
`entrySceneId` points to the scene actually requested, including a later chapter.
SceneSpec remains the serialized authoring source; the native manifests are
versioned derived output.

Native archives add `engine-manifest.json`, `compatibility.json` and content
addressed `models/*.glb`. Original source GLB bytes are always retained. A whole-model canonical GLB is
byte-identical when no material override is requested; requested overrides produce
a derived canonical model. Selected
`assetNode` geometry and procedural shapes are normalized to identity-root GLBs
using the pinned Three loader and the public runtime geometry factory. Godot also
includes `raw/*.glb.bin` and export presets that retain raw bytes and JSON in a
PCK. Inspect archive-specific READMEs before import.

The version-1 manifest also retains the validated campaign with chapter prerequisites
and a separate `scenes[].actorModel` content hash. The actor reference always uses
the whole, unmodified GLB, including chapters with no actor preview node. Unreal
mirrors the exact manifest and canonical models into `Content/VirtualWorldData/`
for packaged runtime loading. These copies also count against the archive limit.

There is one contained, snapshot-checked asset reader and one asynchronous ZIP
path for all targets. Canonical real paths, symlink containment, upload hashes,
GLB validation and campaign deduplication happen before adapter use. Derived
models, Godot raw copies, scripts, manifests, source assets and notices all count
against the logical **uncompressed** archive byte limit as files are emitted.
Exceeding the limit returns HTTP 413. ZIP output is still accumulated in memory;
this is not a streaming-download API. Cancellation is checked during collection,
model generation and asynchronous compression.

## What maps to native engines

The adapters preserve stable wrapper IDs, hierarchy, local translation,
quaternion and scale, effective visibility, models, authored collider declarations,
and source metadata. Coordinates remain right handed, Y up, in metres; authored
angles and joint values are radians. The current joint value is applied on its
authored axis before deriving the intrinsic XYZ quaternion.

Godot uses the canonical quaternion and `GLTFDocument` for model loading. Unity
wrapper poses use X reflection: position `(-x,y,z)`, quaternion `(x,-y,-z,w)`, scale
unchanged. This matches the pinned glTFast conversion; a second reflection scale
is not added around already converted model geometry.

Unreal converts the manifest's Y-up metre coordinates using the same basis as the
pinned glTFRuntime plugin and `SceneScale=100` for centimetres. Apply that conversion
once to wrapper poses; do not transform imported model geometry a second time.

Box collider sizes are full dimensions. Ball collider `size[0]` is a radius. Mesh
collision uses native imported mesh transforms. A hidden ancestor suppresses
collision as well as rendering. Nonuniform scale, shear and animated collision
limitations appear in compatibility findings; do not assume every target physics
engine reproduces browser physics for those transforms.

Godot emits a native camera, directional light and world environment. Its
`build_scene(scene_id)` API selects any retained campaign scene. Calling
`save_scene(scene_id, "res://fresh-name.tscn")` creates an editable PackedScene
with descendant owners; existing files are rejected. Unity creates a fresh native
catalog, scene and prefab per chapter, with the runtime controlling scene selection,
actors, story and mechanism state. Its importer rejects missing model prefabs and
a missing or conflicting GLB importer. Unreal builds the graph through native C++
actors/components and imports whole textured/animated GLBs via glTFRuntime.

## Compatibility limits

Read the structured findings in `compatibility.json` for the exported scene.
Unity and Unreal source runtimes implement actor control/animation, plane and
spherical navigation, interactions, story tasks, campaign prerequisites/save/reset,
and the H-100 harmonic animation and presentation controls. This describes source
coverage, not completed native engine acceptance. Their manifest declares
`runtime.validation: "requires-engine"`; the exporter never promotes that field
because a ZIP or TypeScript test succeeded. Godot continues to retain gameplay
as metadata, with the corresponding unsupported-runtime findings.

Splat rendering, generic joint controls, dynamically deformed collision and
pixel-identical material/environment rendering are outside current native coverage.
Unreal source now implements planar/radial character jumping, gravity and landing,
plus a programmatic movement path in native smoke. `NATIVE_RUNTIME_REQUIRES_VALIDATION`
continues to mark actual engine compilation, collision, keyboard input and visual behavior as unverified by export.
Imported clips in whole GLBs still require native binding/visual verification. Selected
skinned meshes are rejected rather than exported with an incorrect bind pose;
selected model animations are not preserved by geometry extraction and are
reported as a compatibility limitation. Material
and environment approximations are reported. There is no bidirectional native
editing round trip, cross-engine save synchronization or multiplayer implementation.

## Historical Godot engine validation

The integration was validated with **Godot 4.5.1 stable**, official Linux x86_64
build `f62fdbde15035c5576dad93e586201f4d41ef0cb`. The official release SHA-512 was
checked during local tool preparation. The verifier below constructs and exports
a fresh fixture, invokes the real engine headlessly and checks native JSON. It
fails on GDScript parse/runtime `ERROR` output even when the process exits zero.

```sh
node --import tsx scripts/verify-godot-export.ts /absolute/path/to/godot
```

The fixture independently checks a nested asymmetric transform against a
hand-computed world position `(4,4,9)`, basis columns `(0,0,4)`, `(0,-2,0)`,
`(3,0,0)` and mesh bounds `(-5,0,5)` to `(13,8,13)`. Separate uniform-scale cases
verify box dimensions `(2,4,6)`, ball radius `1.5`, actual 12-face mesh collision,
and hidden-ancestor collision suppression. The verifier saves an editable
PackedScene, reloads and instantiates it in a second real engine process and
rechecks the same graph, matrices, bounds and collision. The default project entry runs headlessly; camera and environment
nodes and environment values are inspected. These checks passed on this exact version; they do not
establish all Godot versions or physics simulation behavior. Godot reports that
the derived GLB's default scene is unspecified and selects its sole scene; this
warning does not affect the checked results.

Unity and Unreal Editors are unavailable in the current environment. Source and
export checks do not establish native compilation or execution. The current
cross-target results and remaining gates are recorded separately in
[validation-native-engines.md](validation-native-engines.md).

The focused checks for this stage are:

```sh
npx vitest run tests/engine/export-targets.test.ts tests/engine/export.test.ts tests/engine/engine-export.test.ts tests/engine/campaign-api.test.ts tests/engine/hosted-access.test.ts
npx vitest run tests/engine/export-http.test.ts
npm run check
npx vite build
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chrome node tests/e2e/engine-export-check.mjs
```

The browser check uses a temporary data root, an OS-selected port and a small
authored scene. It waits for its own child process to report successful Fastify
startup before making any HTTP request; a lost port reservation fails safely. It verifies
the default accessible web action, downloads both native ZIPs from the real Studio
UI and checks all three native target manifests and compatibility reports. It also
checks configured-frame lifecycle, current-chapter identity, stale-build rejection
and unavailable-native states. Its small HTML transport fixture is explicitly not
an engine build. It writes evidence
to ignored `output/playwright/engine-export/`. Its
`--verify-startup-failure` mode checks cleanup when the child exits before
readiness. The full repository regression
matrix is reserved for the final cross-stage gate.
