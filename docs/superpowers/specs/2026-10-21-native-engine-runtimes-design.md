# Unity and Unreal runtime integration

## Goal and current evidence

The user requests Unity and Unreal support and engine rendering for the existing
Little Prince and harmonic-joint experiences. The starting revision is
`e5ed66325eb049d5a7bbd4141a002aaf926ac739`. Its Unity exporter creates prefabs,
while actor control, story, campaign and mechanism behavior are metadata only.
There is no Unreal export target. Existing browser/standalone playback and all
source models must remain available; authored SceneSpec is the only source of truth.

## Chosen architecture

Keep authoring and services in the existing React/TypeScript application. Extend
the derived engine manifest with a canonical actor-model binding and campaign
prerequisites. Add native runtime source adapters which consume this manifest.
Unity uses the existing pinned glTFast 6.14.1 importer and native C# components.
Unreal uses a C++ project and a pinned glTFRuntime plugin for complete local GLB
hierarchies, textures, skins and animation. This dependency is explicit and must
be installed before native compilation; do not imitate an engine using Three.js.

A native project command exports the current showcase(s) into a fresh destination,
never overwrites an existing project, and retains original GLBs and attribution.
Native gameplay preserves the IDs and authoring units; conversion is performed
once per adapter (Unity X reflection; Unreal metres/Y-up to centimetres/Z-up,
with the plugin's matching conversion). Story progress is engine-local transient
or separately saved data, never edits to exported SceneSpec.

## Runtime behavior

Both adapters provide scene selection, native camera/light setup and controls.
Little Prince: one player actor (the authored preview is not duplicated), idle/
walk/interact clips, plane bounds, surface-constrained B612 movement, native
collision queries, interaction prerequisites, flags, tasks, dialogue/choices and
chapter gating. Harmonic: unrestricted orbit, speed/step/reset, signed transmission
ratio, power-off brake lock, section/full housings, explode and subsystem controls,
and named signed WaveCos/WaveSin morph weights. No source mesh regeneration.
Unsupported authored features must remain identified in compatibility.json.

## Web entry and deployment

Add an engine selector to the experience route. Existing web rendering remains
available. Unity Web uses a configured built Unity player; Unreal uses a configured
Pixel Streaming frontend. Engine mode unmounts the Three runtime and mounts a
separate engine surface. Missing/unreachable configuration gives a persistent
error and explicit return option; never silently report Three as Unity/Unreal.
Only administrator-configured http(s) URLs are accepted, with project identity
bound to the selected build. Browser requests cannot supply arbitrary runtime URLs.
A local generated project can run independently without the Studio service.

## Verification and boundaries

Run real export/manifest/asset tests, HTTP validation, TypeScript checks, browser
routing and production builds. Include native smoke entry points and local
commands which fail if the engine or dependency is absent. No Unity Editor or
Unreal Editor is installed in this execution environment. Native compilation,
visual parity, platform performance and engine-built web delivery therefore
remain explicit acceptance gates; source export tests cannot certify them.

This change does not promise binary compatibility across arbitrary engine versions,
bidirectional native editing, cloud GPU provisioning, or deterministic physics
parity with Rapier. Document actual adapter limits at delivery.
