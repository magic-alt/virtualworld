# Engine interoperability validation — 2026-10-19

This is the focused Stage A record. The complete combined regression is scheduled
after the streaming-world and graphics stages, as requested. Native scene
interchange is implemented; native gameplay parity is not established.

## Executed checks

| Check                                  | Result                          | What it establishes                                                                                                                                                       |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six focused Vitest files               | 69 tests passed                 | Canonical GLBs, material overrides, selected morph weights, export targets, campaign entry and asset retention, access policy, archive budget and disconnect cancellation |
| TypeScript `npm run check`             | Passed                          | Repository type contracts after native export integration                                                                                                                 |
| `npx vite build`                       | Passed                          | Studio production build; existing large-chunk notice remains                                                                                                              |
| Scoped Prettier and `git diff --check` | Passed                          | Formatting and patch whitespace                                                                                                                                           |
| Real Chromium native export smoke      | 3 checks passed; no page errors | Default web action, Unity and Godot target selection, actual downloads, archive manifests and compatibility notices                                                       |
| Browser harness startup failures       | Passed                          | Early child exit and spawn ENOENT clean up without any HTTP request, verified by independent fetch traps                                                                  |
| Real Godot 4.5.1                       | Passed                          | Default project startup, native graph inspection, editable PackedScene save and reload in another process                                                                 |
| Independent task review                | Approved after fixes            | Core export and application integration reviewed separately; found morph/default-material issues were fixed and re-reviewed                                               |

The focused Vitest command was:

```sh
npx vitest run tests/engine/export-targets.test.ts tests/engine/export.test.ts tests/engine/engine-export.test.ts tests/engine/campaign-api.test.ts tests/engine/hosted-access.test.ts tests/engine/export-http.test.ts
```

Core export development first observed failing selected-morph and implicit-material
cases, then passed all 18 core cases after the correction. The six-file run above
includes those cases; the counts are not additive. No source model, existing
world template, license or dependency lockfile was changed.

## Native engine evidence

The Godot binary was the official Linux x86_64 **4.5.1 stable** release, build
`f62fdbde15035c5576dad93e586201f4d41ef0cb`, checked against the official SHA-512
release sums. Run the committed verifier with an installed binary:

```sh
node --import tsx scripts/verify-godot-export.ts /absolute/path/to/godot
```

Both live and reloaded graphs contained 33 inspected native nodes. Expected values
are independently specified literals, not calculated by the export implementation:
world position `(4,4,9)`, basis columns `(0,0,4)`, `(0,-2,0)`, `(3,0,0)`, and
mesh AABB `(-5,0,5)` to `(13,8,13)`. Other fixtures check full box dimensions
`(2,4,6)`, ball radius `1.5`, 12 mesh-collision faces, inherited hidden state,
camera and environment. Native error output is rejected even with a zero exit
code. The verifier initially exposed an inspector lifecycle error; deferring
inspection until the scene is in the tree corrected it.

The passing run had zero errors and 15 nonfatal messages about an unspecified
default GLB scene; each affected derived GLB has one scene, which Godot selects.
This fixture proves the inspected transforms, bounds and collision declarations,
not physics simulation, visual parity or compatibility with every Godot version.

Unity Editor is unavailable in this environment. Tests inspect the generated
importer/project structure. Official glTFast **6.14.1** source confirms the adapter's
X reflection: position `(-x,y,z)`, quaternion `(x,-y,-z,w)`, unchanged scale.
Native Unity compilation, import and execution remain an explicit next gate.

## Browser evidence and reproducibility

The smoke used Chromium **141.0.7390.37**, an isolated temporary data root,
an OS-selected port and an owned readiness marker after successful Fastify listen.
It also verified failure cleanup before any fixture request. The screenshot was
captured and inspected with a CJK font configuration; Chinese controls and notices
are readable. The generated archives, screenshot and JSON report are written to
ignored `output/playwright/engine-export/`.

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chrome node tests/e2e/engine-export-check.mjs
node tests/e2e/engine-export-check.mjs --verify-startup-failure
```

If the host has no Chinese fonts, provide a Fontconfig configuration with an
installed CJK font through `FONTCONFIG_FILE`; this is a test-host prerequisite.
No application font or dependency was changed for the smoke.

See [engine-interoperability.md](engine-interoperability.md) for the supported
mapping, retained source data and compatibility limits.
