# VirtualWorld Studio contributor guide

- Use Node.js 24 and npm. `npm ci`, then `npm run dev`. `npm run build` builds studio and standalone player; `npm test` prepares fixtures and runs unit/integration checks.
- Keep SceneSpec as the only serialized source of truth. All edits, including AI proposals, use validated atomic SceneCommands. Preserve metres, Y-up, radians and stable IDs.
- AI returns declarative proposals. Never evaluate generated code. Keep provider keys server-side. AI must not mark engineering parameters as human-confirmed.
- Bind asynchronous editing work to project identity and generation. A stale response must never modify another project.
- Derive imported mesh paths from the final serialized GLB. Check visible geometry, hierarchy and physical units, not only successful parser responses.
- Reuse the runtime in the editor and player. Keep play state transient, release GPU/physics resources, and test export without editor service or external network.
- Tests: `npm test`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run format:check`, `npm audit`. Browser artifacts live in `output/playwright/` and are ignored by Git.
- Report only executed checks as passing. Local HTTP model fixtures are not validation against a live paid provider. Do not claim unrun browser/hardware/soak checks.
- Do not commit `.env`, `data/`, build artifacts or generated CAD vendor binaries. Preserve third-party notices and pinned package-lock.json.
