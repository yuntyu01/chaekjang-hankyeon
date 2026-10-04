# Continuous jacket lighting

The reported parallel edge bands came from sampled rim shading, overlapping edge gradients, fixed hinge strokes, and a separately lightened plain cover. The change removes these duplicate cues while retaining the home book composition and shared 3D scene.

- Resample the measured spine material's interior, excluding its baked rim pixels. Preserve its broad colour variation and grain.
- Match the plain cover and board base colour to the spine material instead of separately tinting the cover white.
- Replace four five-stop edge overlays with one continuous SkSL normal field. Adjacent jacket faces approach a common bisector normal; corners are evaluated once rather than stacking two strips.
- Use book rotation and the existing world light for diffuse shading. The weak, broad reflection also reads the shared camera direction. Hinge shading is a shallow normal perturbation rather than fixed dark/light strokes.
- Keep the same camera projection, book placement, shelf structure, shadow caster and receiver calculations. This is rounded-surface shading over the existing planar geometry, not a new bevel mesh. Cast-shadow geometry remains the existing box model.

Validation:

- `npm.cmd run typecheck`: passed.
- Six existing suites (`page-structure`, `projection`, `view-pitch`, `book-cast`, `received-shadow`, `scene-pick`): 44 tests passed.
- `npx.cmd expo export --platform android --output-dir .expo/continuous-jacket-export`: passed.
- Android runtime shader compiled and rendered successfully after a full reload. Initial development compilation error from the reserved SkSL identifier `flat` was corrected before final verification.
- Native home render checked at the saved 4.5° camera and at 8°. Screenshots are `after.png` and `camera-8.png`; `before.png` is the previous committed render. The temporary camera override used for QA was removed, and `HomeScreen.tsx` has no final diff. Saved user camera settings and book data were not changed.
- Additional browser enlargement was stopped by Computer Use because it could not reliably determine the browser URL. No further UI automation was attempted; the final source restoration was verified by Git. The comparison HTML is provided for review but its updated browser rendering was not checked in this turn.
