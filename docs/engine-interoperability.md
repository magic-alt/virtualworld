# Engine exports

Studio's **导出目标** selector provides three archive targets. The initial target is
**网页** and the existing **导出网页** action is preserved. Native downloads include
the target in their filenames and direct users to `compatibility.json`.

| Target        | Deliverable                                                                                         | How to use it                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (default) | Existing standalone browser player, `scene.json`, assets and optional campaign chapters             | Build the player with `npm run build`, extract the archive and serve it over HTTP.                                                                                                                                                                                    |
| Godot 4       | `project.godot`, `main.tscn`, native importer, canonical GLBs, packaged raw GLB bytes and manifests | Open the extracted project in Godot. Run `main.tscn`; the requested current scene is the entry scene.                                                                                                                                                                 |
| Unity 6       | Editor importer, metadata component, canonical GLBs and manifests                                   | Install `com.unity.cloud.gltfast` **6.14.1** in an existing Unity project. Copy the extracted archive into a fresh, unique subfolder of `Assets`, allow imports to finish, then use **Tools > VirtualWorld > Import manifest**. See `README-Unity.md` in the archive. |

Native archives do not require `dist/player` or any player build. They are scene
interchange adapters; the browser runtime remains the playable reference.

## Protocol and archive contract

`POST /api/export` accepts `{ "scene": <SceneSpec>, "target": "web" | "unity" |
"godot" }`. Omitting `target` retains web behavior. Other values, including null,
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

There is one contained, snapshot-checked asset reader and one asynchronous ZIP
path for all targets. Canonical real paths, symlink containment, upload hashes,
GLB validation and campaign deduplication happen before adapter use. Derived
models, Godot raw copies, scripts, manifests, source assets and notices all count
against the logical **uncompressed** archive byte limit as files are emitted.
Exceeding the limit returns HTTP 413. ZIP output is still accumulated in memory;
this is not a streaming-download API. Cancellation is checked during collection,
model generation and asynchronous compression.

## What maps to native engines

Both adapters preserve stable wrapper IDs, hierarchy, local translation,
quaternion and scale, effective visibility, models, authored collider declarations,
and source metadata. Coordinates remain right handed, Y up, in metres; authored
angles and joint values are radians. The current joint value is applied on its
authored axis before deriving the intrinsic XYZ quaternion.

Godot uses the canonical quaternion and `GLTFDocument` for model loading. Unity
wrapper poses use X reflection: position `(-x,y,z)`, quaternion `(x,-y,-z,w)`, scale
unchanged. This matches the pinned glTFast conversion; a second reflection scale
is not added around already converted model geometry.

Box collider sizes are full dimensions. Ball collider `size[0]` is a radius. Mesh
collision uses native imported mesh transforms. A hidden ancestor suppresses
collision as well as rendering. Nonuniform scale, shear and animated collision
limitations appear in compatibility findings; do not assume every target physics
engine reproduces browser physics for those transforms.

Godot emits a native camera, directional light and world environment. Its
`build_scene(scene_id)` API selects any retained campaign scene. Calling
`save_scene(scene_id, "res://fresh-name.tscn")` creates an editable PackedScene
with descendant owners; existing files are rejected. Unity creates a fresh prefab
per scene and retains scene settings as metadata where direct prefab mapping is
not meaningful. The importer checks for missing model prefabs and a missing or
conflicting GLB importer instead of treating failed imports as success.

## Compatibility limits

Read the structured findings in `compatibility.json` for the exported scene.
Interactions, story tasks, campaign progression, actor behavior and joint control
are retained as metadata and do not execute as native gameplay. Requested clip
playback, splat rendering, spherical locomotion and harmonic control/deformation
are not implemented by these adapters. Imported animation clips are retained in
whole GLBs; this does not establish native animation playback parity. Selected
skinned meshes are rejected rather than exported with an incorrect bind pose;
selected model animations are not preserved by geometry extraction and are
reported as a compatibility limitation. Material
and environment approximations are reported. There is no bidirectional native
editing round trip, multiplayer implementation or migration of the browser
runtime into Unity/Godot.

## Executed validation

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

Unity Editor was unavailable. Unity export structure and importer code have
focused automated coverage, and the official glTFast **6.14.1** source was checked
for the exact X reflection, but **native Unity import/execution is not claimed**.

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
UI and checks their target manifests and compatibility reports. It writes evidence
to ignored `output/playwright/engine-export/`. Its
`--verify-startup-failure` mode checks cleanup when the child exits before
readiness. The full repository regression
matrix is reserved for the final cross-stage gate.
