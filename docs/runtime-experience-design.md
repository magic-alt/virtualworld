# Runtime and experience improvements

## Goal and constraints

Improve the existing local web application: make the Little Prince chapters understandable and playable through visible controls, make H-100 inspection predictable, and reduce unnecessary startup and resource costs. This implements the user's request to optimize the technology route and the two existing experiences.

- Keep React 19, Three.js, TypeScript, Vite, Fastify, Rapier and the existing workspace boundaries. Keep Node.js 24 and the pinned lockfile.
- SceneSpec remains the serialized source of truth; mechanism presentation and story progress remain transient/separate.
- Do not change GLB files, source models, mesh recipes, engineering dimensions, teeth counts, materials or model geometry.
- Reuse experience and mechanism controls in the application and standalone player; preserve offline exports.
- Base revision: `cd13e3e74b60085c31810d165a8a59806b2184b2`.

## Chosen route

An incremental improvement to the current stack fits the existing asset and runtime investment. Replacing the engine would invalidate the shared runtime and export work without resolving the observed interaction bugs. Updating every dependency would introduce unrelated compatibility changes. This change instead establishes useful lazy-loading boundaries, cache revalidation and shared presentation behavior.

The home page should render its existing poster before initializing a visible, idle-time 3D preview. Experience code loads when entered; Rapier and Spark retain their existing on-demand imports. Static serving should stream large assets and support conditional requests; mutable GLB URLs must revalidate. Screenshots should render on demand rather than require preservation of every frame's drawing buffer.

## Little Prince

All interaction entry points use one availability rule: available, locked, completed or none. Automatic nearby interaction prioritizes available unfinished tasks, so the old rose-garden interaction cannot intercept the final reflection. Explicit hotspot clicks can replay completed dialogue. A shared hotspot layer provides visible, accessible buttons, with range and story-state explanations, in both the application and export.

Planar movement follows the camera projected onto the floor, as spherical movement already does. Move the B-612 sunset anchor beside the existing chair, without changing the asset. Chapter completion distinguishes a next chapter from the end of the campaign and offers an appropriate action.

## H-100 inspection

Separate named camera views from reframing along the current direction. Explode, cutaway, panel resize and subsystem visibility should not discard a manually chosen viewing direction. Subsystem selection is a presentation state: pick a visible part, read the matching description, focus it, or isolate it. No transform handles or SceneCommands are triggered by inspection.

An uninstalled optional brake cannot be focused or isolated. Removing a currently isolated brake exits isolation. Shared controls report selected, visible, isolated and unavailable states; narrow screens must retain readable controls and values. The advanced editor should consume the same mechanism state/control surface while retaining ordinary non-mechanism editing.

## Acceptance

Run the repository's unit/integration, typecheck, production build, format and audit gates. Add regressions that exercise real story availability, camera-relative movement, preserved mechanism orientation, optional-part availability and HTTP validators. Browser checks must click visible hotspots, use the mechanism panel on desktop/mobile, exercise independent export, and verify on-demand PNG screenshots. Compare asset hashes against the base commit. Report actual measurements and explicitly separate any unexecuted hardware or provider checks.

## Subsequent route

After these corrections, evolve scene updates from whole-runtime reconstruction toward retained renderer instances and incremental SceneCommands, with cancellation and resource ownership tests. Large world streaming, asynchronous export jobs and advanced GPU paths should follow measured workload needs; they are outside this change.
