# Source assets

`builtin/*.recipe.json` are committed, deterministic source recipes. `npm run fixtures` regenerates their raw GLB and runtime GLB/PLY, with hashes in `assets/manifests/builtin/`.

`vendor/occt/` is prepared from the pinned occt-import-js npm distribution (LGPL-2.1); its source receipt is in the manifest directory. `uploads/` retains imported original CAD/GLB/Splat bytes. `generated/` retains provider downloads and reference images. Those binary files and user data are ignored by Git.
