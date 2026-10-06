# Map-first assessment entry

The dock no longer contains a separate CLS report action. Its existing profile, walk, environment-observation and source-status actions remain; the Street Library button stays alongside search.

Selecting a map location/road, clicking the selected-location pin or choosing a search result opens the assessment workspace using the existing persisted-data loader. GPS location updates alone do not open it. Saved-score badges and library records still open each saved visit's report with its field adjustment and evidence.

While a workspace is open, clicking map background dismisses it without changing the location or fetching new data. Clicking an interactive road selects that road. Dragging the map does not dismiss. Escape restores focus to the map/search opener. Keyboard users can focus the labelled Street map and press Enter to assess the current map centre; the handler ignores Enter on child markers/controls.

No new API endpoints, polling, automatic saving or external-source acquisition were added. Browser regression tests cover desktop/mobile removal of the old action, pointer/pin/search/keyboard entry, one assessment read per explicit selection, dismissal without reads, existing navigation/readability and saved-map/library report behavior.
