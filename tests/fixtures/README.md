# Isolated regression scenes

These documents are test-only geometry and story fixtures. The four old public examples were removed from `worlds/`; application and generator entry points do not import these fixtures. Their IDs/names have been changed to `test-*` and generic fixture labels.

Unit tests assemble fixtures using `scenes.ts`. Browser regression checks explicitly upload fixtures only into their own temporary API data roots, so CAD/edit/save/Splat/story/async regressions remain testable without restoring removed product examples. Normal development starts with H-100 and the three Little Prince chapters only.
