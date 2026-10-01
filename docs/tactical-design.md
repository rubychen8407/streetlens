# StreetLens tactical interface

The dark map uses slate canvas (`#0E131A`), translucent raised surfaces (`#1A212B`–`#1E2632`), 8% white hairlines and 20px corners. Chartreuse (`#D4F971`) highlights primary actions and active states. Error/warning colors retain their existing meaning. Shared tokens and responsive rules live in `src/styles/tactical.css`.

- Desktop (1024px+): 64px icon dock, top search/tools and utility pills, source-backed street overview and category cards. Assessment stays in a separate right panel.
- Mobile/tablet: one aligned search/tools row, 44px main map controls, scrollable bottom assessment panel with anchored primary action and safe-area padding. Short landscape viewports and layer menus have bounded heights.
- Overview gauges use actual CLS, keep missing scores empty and label estimates. No simulated live/video/operational data is introduced.
- Plus Jakarta Sans is bundled locally with its SIL Open Font License; Chinese falls back to installed CJK/system fonts. Leaflet CSS is bundled, removing a runtime CDN dependency.
- Keyboard: layer switches support Space/Enter, Escape closes menus/panels, assessment returns focus to its opener. Non-modal panels keep map access. Visible focus and reduced-motion preferences are respected.

`npm run ci` includes existing score/data-integrity tests and browser tests at 320, 390, 768, 844 (landscape), 1024 and 1440px. Assertions cover horizontal overflow, search/tool alignment, main touch targets, menu/panel bounds, visible footer actions, keyboard switches and focus restoration, in addition to the existing walking/saving/CLS regression flows. Test API/GPS fixtures never enter production data; external map tiles are excluded from deterministic CI.
