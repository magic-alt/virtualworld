# VirtualWorld Studio approved design

User-approved: dual demos sharing SceneSpec and runtime; real configurable Chat Completions LLM with built-in assets; STEP and GLB import; third-person story exploration; Windows local studio and independent static export.

React editor and imperative Three.js WebGL2 + Spark renderer. Rapier character collision. SceneSpec v1 uses stable IDs, metres, Y-up, radians, revisioned atomic commands and declarative interactions. AI returns proposed commands, never executable code. CAD geometry is separate from confirmed kinematics. Local files persist projects. Export contains runtime, relative assets and WASM without credentials or server dependencies.

Acceptance: both demos edit/save/reopen/export; STEP hierarchy and unit checks; mesh+splat rendering; character collision and complete story; AI edit preserves unrelated nodes; stale/invalid edits rejected; exported experiences work under a subdirectory with external network blocked. Real API and GPU performance require actual measured evidence.
