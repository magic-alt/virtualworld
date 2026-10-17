# Architecture and extension contracts

## SceneSpec v1

`packages/scene/src/schema.ts` is the runtime Zod schema and TypeScript type source. One project owns one scene with nodes, assets, environment, camera, spawn and declarative tasks. Nodes have stable IDs, optional parent IDs and local transforms. Units: metres, Y-up, radians. Runtime state (physics, animation time, collected flags, selection, explosion amount) is never serialized into the saved scene.

GLB mesh nodes reference an asset plus an `assetNode` child-index path relative to GLTFLoader's returned scene. Source transforms become SceneSpec transforms; runtime extracts geometry/material only from that path. CAD-generated GLB is reloaded before paths are derived, so exporter scene wrappers cannot silently alter the mapping. Built-in shapes bake dimensions into geometry so editable scale is independent of shape size.

Scene validation covers finite positive dimensions/scale, ID uniqueness, parent cycles, asset types, joint limits and reachable story prerequisites. `applyCommands(scene, baseRevision, commands)` validates and applies an entire batch to a clone, then increments the revision. Invalid batches never mutate their input. `SceneHistory` retains up to 100 session undo entries; undo and redo also increase revisions. Undo history itself does not persist after reopening.

`configureScene` updates camera, spawn, task journal or description through the same validated transaction. This lets AI create a complete story from a blank project and lets the editor save its current view as the portable default camera.

## Local HTTP API

| Endpoint | Input | Result |
| --- | --- | --- |
| `GET /api/projects` | — | Local project metadata, built-in templates, AI configuration status |
| `GET /api/projects/:id` | Stable ID | SceneSpec |
| `PUT /api/projects/:id` | `{scene, baseRevision}` | Saved SceneSpec; stale/conflicting writes return 409 |
| `POST /api/assets?name=...` | Octet-stream, up to 100 MiB | Digest-addressed asset metadata |
| `POST /api/agent` | `{scene, prompt, selectedId?}` | `{projectId, baseRevision, summary, commands}` |
| `POST /api/validate` | `{scene}` | Structural and local resource availability check |
| `POST /api/export` | `{scene}` | Portable static ZIP |

The server binds loopback, accepts local studio origins only and exposes no credential API. File names/IDs and resolved paths are constrained. Project writes are serialized per ID and use temporary-file + atomic rename. An unchanged revision cannot contain altered data. Read errors other than not-found remain errors, rather than silently replacing a broken project with a template.

## AI boundary

The configurable provider is ordinary server-side HTTP. It receives current SceneSpec, user intent and selection. It returns whitelisted declarative commands, never executable code. Both command syntax and resulting scene are validated. Joint confirmation is forced false for AI-proposed joint definitions. Transport errors are not automatically retried; invalid JSON/commands receive at most one repair request. Cancellation propagates to provider fetch.

The client scopes async work to a project generation, aborts AI/import operations on project switches and checks project ID + revision again when applying proposals. Returning to a project with the same ID does not reactivate older work.

Future asset generation providers should return ordinary asset metadata and node commands through the same boundary. No Tripo, Meshy or Marble adapter is claimed in v1.

## Runtime and export

`StudioRuntime` owns the WebGL context, resource lifetime, loading, object selection, transforms, camera, animation and play state. Public methods include `load`, `select`, `focus`, `play`, `stop`, `explode`, `animateJoints`, `getDiagnostics` and `dispose`. `window.virtualworld.getDiagnostics()` exposes FPS, GPU, draw calls, triangles, loading/errors and story/player state for support and performance inspection.

Spark and Rapier are loaded when needed. Splats participate in rendering; explicit proxy colliders supply physical behavior. Mesh assets use actual GLB geometry. Play mode clones the scene and owns temporary character/story state. Stop/dispose release character bodies, geometry, materials, textures, shadow maps and helper resources.

Export uses the production player build, embeds all referenced resources under relative paths, and ships the same SceneSpec interpreter as the studio. Imported CAD is already converted, so OCCT is excluded. The player has no project persistence or model connection. Serving under a directory prefix and blocking external network are tested behaviors.
