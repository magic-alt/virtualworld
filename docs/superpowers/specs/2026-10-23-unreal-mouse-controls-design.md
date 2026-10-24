# Unreal mouse controls

Repair the existing native viewport mouse control for the local H-100 review. Use visible-cursor viewport coordinates instead of relying on captured relative mouse input. In the mechanism viewport, left/right drag orbits, middle drag pans, and the wheel zooms. Preserve keyboard controls and Home camera reset without modifying mechanism state. Keep left-click story interaction in Prince, with right-drag orbit.

The HUD owns its dynamically sized panel; a press starting there cannot become a camera drag by crossing into the viewport. Release, lost mouse position and focus loss end the gesture. A new gesture establishes its origin before producing motion. Use windowed 1280x720 launches. Preserve verified UE5.8 build, collision and neutral reflection fixes; do not change model GLBs or serialized scene parameters.

## Approaches

Use viewport position differences (chosen: works with a visible cursor and HUD). Continuing captured relative deltas would keep the reported incompatibility. Adding an editor-only orbit controller would not serve standalone play.

## Validation

Native automation tests cover gesture boundaries and focus/release. Actual UE compilation, fresh native smoke reports, and a mouse drag/zoom observation verify integration. All unperformed manual and packaging gates remain pending.
