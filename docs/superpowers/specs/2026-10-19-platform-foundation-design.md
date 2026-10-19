# VirtualWorld platform foundation design

## Intent and baseline

The user requested a source audit of 3D formats, browser rendering, AI generation,
game-engine support, architecture, hosted use and multiple users, followed by a
new branch implementing deeper improvements. Base: `e610e685999ea4766657e50f4d5fedd37bbce9a7`.
PRs #5 and #6 are already merged. This change preserves their interaction and
WebGL recovery work and all shipped model geometry.

## Decision

Keep the React / Three.js / Rapier / Spark / Fastify modular monolith. Strengthen
the existing content and service contracts. Do not replace the renderer or add
a second game engine as a proxy for missing backend functionality.

The deliverable is a more reliable local studio plus an explicit **private,
shared team workspace on one service instance**. Hosted access requires an
authenticating reverse proxy and a separate strong gateway secret checked by
the application. Every authenticated team member shares the same projects,
assets and generation history. This is not tenant isolation, simultaneous
mergeable editing, or real-time multiplayer. Public visitors should receive
standalone exported worlds rather than access to the studio API.

Alternatives considered: a new multi-tenant database/OIDC platform would require
account, ACL and migration product decisions; a multiplayer engine would add a
separate transient-state authority and networking protocol. Both remain explicit
next stages, not incomplete stubs in this branch.

## Invariants

- Node.js 24 and npm; preserve pinned dependencies and package-lock.json.
- SceneSpec is the serialized source of truth; edits use atomic SceneCommands.
- Preserve metres, Y-up, radians, stable IDs and independent story progress.
- Preserve source / optimized / manifests, provider identity and paid ledgers.
- No automatic paid-create retry, generated-code execution, or client API keys.
- Preserve current GLBs, world templates, Blender geometry and offline player.
- Report only executed tests; mocked providers are not paid-service validation.

## A. Asset fidelity and publication

Static triangle hierarchies remain decomposable for per-part CAD editing.
GLBs with skeletons, animation, mirrored transforms or object classes that the
decomposed SceneSpec cannot represent must retain their full glTF root under an
identity wrapper. Preserve visibility and imported clip metadata using existing
node animation semantics; independent instances must own independent skeletons.
Do not change authored physical scale or silently lose visible geometry.

Server publication must validate GLB self-containment, supported required
extensions and Khronos structural validity before writing runtime files or
manifests. Retain warnings. Export revalidates runtime GLBs so legacy or changed
files cannot bypass the contract. STEP remains source input for browser OCCT
conversion; it is never accepted as a playable runtime GLB.

## B. Service ownership and bounded work

A service holds an exclusive filesystem lease before generation recovery and
releases it after work closes. A second instance sharing the data directory must
fail before mutating job records. Ambiguous/stale leases fail closed with an
operator recovery instruction; do not silently steal a paid-work lease.

Project listing reads the world catalog once per request and overlays saved
projects without repeating complete world assembly for every item. Discovery
must remain fresh on the next request, including externally generated worlds.

Generation admits at most 8 active-or-queued jobs by default, executes one at a
time, returns 429 when full, and creates no record/provider side effect for a
rejected request. Existing request IDs remain retrievable even at capacity.
Explicit resume observes the same capacity; close rejects new admission and
does not resubmit uncertain paid work. Interactive AI and export have separate
admission limits (2 and 1 respectively), released in finally blocks.

## C. Export resource boundary

Replace synchronous compression on the API thread with fflate's asynchronous
compression. Bound uncompressed inputs to 256 MiB by default, count before
reading each file, deduplicate repeated assets, check containment through
realpath, validate GLBs, and support cancellation. This is a bounded in-memory
export, not unlimited streaming. Preserve actual offline chapter/export tests.

## D. Hosted access and durable paths

Local is the default mode and only permits loopback binding/Host and the
existing loopback development origins. Hosted mode requires an explicit HTTPS
public origin and a gateway secret of at least 32 characters. Do not trust
client-supplied forwarded identity or host headers. All studio/API/asset routes
require the gateway header; only a minimal liveness endpoint is public. Exact
Origin checks supplement authentication. API responses are private/no-store;
unexpected errors return a generic 500 while server logs retain request IDs
without request bodies or secrets.

Provide a reverse-proxy/container example with edge authentication, TLS, a
non-published internal service port and a persistent workspace volume. Generated
worlds and their source/optimized/manifests must survive container replacement;
data location must be explicit and must not require writing into bundled code.
Local existing directories remain compatible. No actual external deployment is
part of this change.

## Acceptance

Prove malformed uploads cannot publish; complex GLBs retain rig/visibility and
independent instances; static CAD remains editable; full queue replays work;
overload creates no work; second service cannot rewrite live jobs; catalog scans
are linear within a request; export limits and cancellation work; protected
requests, wrong/missing secrets, cross-origin writes, and durable paths are
tested. Run existing unit/integration, typecheck, build, browser, WebGL, format
and dependency checks where the environment supports them. Record limitations
and validate all unchanged shipped GLB hashes.
