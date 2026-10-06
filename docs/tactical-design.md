# StreetLens tactical interface

The dark map uses slate canvas (`#0E131A`), translucent raised surfaces (`#1A212B`–`#1E2632`), 8% white hairlines and 20px corners. Chartreuse (`#D4F971`) highlights primary actions and active states. Error/warning colors retain their existing meaning. Shared tokens and responsive rules live in `src/styles/tactical.css`.

- All screen sizes: the top search/location bar selects a street, locates the user and opens Street Library as the multi-location overview. The dock contains only current-location actions: field mode, CLS report, environmental observations and Data Status (database icon). Data Status shows the current street, source availability and update times; it is not a settings page. Desktop uses the left rail, while mobile uses a translucent bottom dock. Map-layer controls are removed.
- Mobile/tablet: one aligned search/tools row, 44px main map controls, scrollable bottom assessment panel with anchored primary action and safe-area padding. Short landscape viewports and layer menus have bounded heights.
- Overview gauges use actual CLS, keep missing scores empty and label estimates. No simulated live/video/operational data is introduced.
- Plus Jakarta Sans is bundled locally with its SIL Open Font License; Chinese falls back to installed CJK/system fonts. Leaflet CSS is bundled, removing a runtime CDN dependency.
- Keyboard: layer switches support Space/Enter, Escape closes menus/panels, assessment returns focus to its opener. Non-modal panels keep map access. Visible focus and reduced-motion preferences are respected.

`npm run ci` includes existing score/data-integrity tests and browser tests at 320, 390, 768, 844 (landscape), 1024 and 1440px. Assertions cover horizontal overflow, search/tool alignment, main touch targets, menu/panel bounds, visible footer actions, keyboard switches and focus restoration, in addition to the field-observation, historical-record preservation and CLS regression flows. Test API/GPS fixtures never enter production data; external map tiles are excluded from deterministic CI.

## Language selection

The former SL mark is now a Profile Settings button. It opens a keyboard-accessible modal with language and dark/light appearance choices. Theme is remembered separately in `streetlens-theme`; the light palette applies to the map, reports and controls, while live camera overlays retain dark contrast. Desktop dock height fits its contents and Data Status sits directly below observations. Every dock action has a hover/focus tooltip and the currently open view is highlighted; closing a view clears its selection.

The search toolbar, assessment panel and full-screen field walk include a language switch. The interface defaults to Traditional Chinese and remembers `zh-TW` or `en` in the separate `streetlens-language` preference. UI labels, accessibility text, field definitions, system notices and dates follow the selection. Proper place names and user-authored notes retain their original text; saved assessments and evidence are not migrated or rewritten.

AI explanation requests include `language=zh-TW` or `language=en`. The server validates the value and instructs Gemini to use it for the summary and every list item. An output guard rejects obvious language mismatches. Changing language or saved assessment clears the prior explanation and cancels its request; late replies cannot replace an explanation in the new language. Generate again to get the selected language. CI covers translation completeness, request language, mobile layout, preference persistence, stale responses and unchanged saved records. Real Gemini generation requires the deployment's credentials and is not exercised by deterministic fixtures.
