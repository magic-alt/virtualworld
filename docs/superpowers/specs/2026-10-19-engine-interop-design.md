# Engine Interoperability Design

## Intent and phased delivery

The user requests continued implementation toward a metaverse: native game-engine
support, continuously extensible worlds, mainstream browser GPU use and improved
world experience. Each stage is committed and published as a PR; the full
regression matrix runs after all stages. PR #7 is merged into main at
`bab3172ee5d109dca5523e3b41abe7d359007a37`, whose source tree equals the previously
verified platform-foundation tree.

This stage provides usable Unity and Godot scene interchange. The following stages
add bounded procedural terrain streaming with a floating origin, then GPU
capability reporting and adaptive resolution. Keep the current browser runtime
and SceneSpec. Native engine migration, a generic neutral-only asset archive and
a full bidirectional gameplay translator were considered; concrete one-way
adapters give useful interoperability while keeping product semantics explicit.

## Scope and native contract

Add `web | unity | godot` export targets; omitted target remains `web`. Native
exports work without a browser-player build. They retain existing authenticated
access, export admission, cancellation, path containment, snapshot integrity,
asset validation, deduplication and logical uncompressed byte budgeting.

`SceneSpec` remains the serialized authoring source. A derived version-1
`engine-manifest.json` carries:

- Right-handed, Y-up, metre coordinates and xyzw quaternions.
- The entry scene ID, all campaign scenes when present, stable IDs, parent links,
  local translation/quaternion/scale, visibility, canonical model bindings,
  collider declarations, camera/spawn/environment and retained source metadata.
- Content-addressed model paths, SHA-256 and byte lengths, with original asset
  identity and selected source path where relevant.
- Structured compatibility findings with code, feature, severity and optional
  scene/node/asset identity. `compatibility.json` is also readable separately.

Native nodes are stable wrappers around canonical GLBs. Apply joint.value to the
authored rotation axis before deriving Three intrinsic XYZ quaternions. Unity
wrappers reflect X: position (-x,y,z), quaternion (qx,-qy,-qz,qw), unchanged scale.
Godot uses the canonical quaternion directly. Do not apply a second negative
scale around glTFast's already converted model geometry.

Original source GLBs remain byte-identical. Whole canonical GLBs also remain
byte-identical when no material override is requested; overrides derive a model.
Procedural shapes are baked using the
existing public `primitive()` geometry factory; native stock shapes do not have
the same dimensions or construction. Decomposed assetNode references are
resolved against the pinned Three loader and normalized into identity-root GLBs.
Do not interpret a Three child path in a target-engine hierarchy. Preserve source
GLBs alongside derived assets. Material overrides must follow current runtime
semantics; unsupported features are reported, never silently described as mapped.

Box collider sizes are full dimensions; ball.size[0] is a radius. Mesh collision
uses the actual imported mesh transforms. Inherited visibility disables the
corresponding native collision. Nonuniform scale/shear and animated collision
limitations must be identified. Retain interaction/story/campaign/actor/joint
metadata, but explicitly report gameplay that is not executed by the adapter.
Splat rendering, spherical locomotion and harmonic control/deformation are not
implemented by these native adapters. Assets carrying animation retain clips;
requested playback is reported as unmapped unless explicitly implemented.

## Unity deliverable

The archive is copied into a unique folder under an existing Unity project's
Assets directory. It includes Editor/VirtualWorldImporter.cs, runtime metadata
components, models, manifests and instructions. Target Unity 6 with
com.unity.cloud.gltfast 6.14.1; the importer itself uses native UnityEditor APIs,
not glTFast C# types. glTFast imports GLBs into prefabs in AssetDatabase.

A Tools/VirtualWorld import action selects the manifest, validates its version
and safe paths, imports models synchronously, checks every prefab result, builds
parent-ordered native objects and supported colliders, and saves one prefab per
scene to a fresh output location. It must not overwrite existing user scenes or
prefabs. Report a missing/conflicting GLB importer clearly and remove partial
temporary objects on failure. A batch verification entry point is desirable, but
Unity execution is not claimed without the actual editor.

## Godot deliverable

Emit an actual Godot 4 project with project.godot, main.tscn, importer and native
camera/environment, metadata and supported collision. The default entry scene
opens when the project runs; other campaign scenes remain selectable by ID in
the import API/editor tool. The same importer can save an editable PackedScene,
assigning descendant owners correctly.

Use GLTFDocument to import canonical GLBs. If using runtime raw-byte loading,
retain canonical bytes under raw/\*.glb.bin and include raw files/JSON in the
export configuration, rather than assuming imported .glb source files survive
Godot PCK export. Count those bytes in the archive budget. Provide a headless
inspection entry point producing JSON for real validation. Pin and report the
exact Godot binary used; do not claim every Godot minor release is tested.

## Browser and service integration

Add an accessible export target selector next to the existing export action.
The default action remains "导出网页" so existing flows remain stable. Native
success messages identify the target and the compatibility report. Server input
validates the optional enum and uses the same export operation gate. Full
campaign and license/attribution retention continue to work.

Split existing archive collection from target generation only as needed; there
must be one shared contained/bounded asset-reading and asynchronous ZIP path.
Budget derived models, scripts and metadata as they are emitted, not after an
unbounded result has accumulated. No new public raw asset route is needed.

## Constraints

- Node.js 24 and npm; preserve pinned third-party versions and package-lock.json.
- Preserve existing model bytes, world templates and license contents.
- Use public workspace exports; runtime packages never import Node/generators.
- SceneSpec is authoritative; metres, Y-up, radians, stable IDs and atomic commands.
- No paid provider calls, secret exposure, main merge or external deployment.
- Run focused tests per stage; run the complete regression matrix at the end.

## Acceptance

Real normalized GLBs pass the existing validator and load with the pinned loader.
Tests cover asymmetric mixed-axis transforms, selected mesh identity, procedural
dimensions, material overrides, hidden hierarchy, box/ball/mesh collider units,
multiple scenes, unsupported-feature findings, invalid targets, byte limits,
cancellation and native export without playerRoot. Existing web export behavior
remains covered. Run a real Godot binary against an exported fixture and inspect
the native graph/colliders/bounds. Unity execution remains an explicit gap if its
editor is unavailable. No claim of multiplayer or full gameplay conversion.
