# Saved CLS on the map

The map reuses the `savedLocations` array already loaded by the application. It
does not add an endpoint, database read, history fetch, polling timer, image or
external icon. Moving/zooming the map renders the local overlay again; normal
basemap tile loading is unchanged.

Each coordinate group (the existing five-decimal grouping, approximately one
metre) shows its most recent valid completed CLS. Newer pending records do not
hide an older completed score. Zero is valid; null, non-finite, out-of-range
scores and invalid coordinates are not displayed. No stored score is rounded
or rewritten: labels show at most two decimals only.

The current viewport, with a small edge buffer, displays at most 200 badges,
newest first. Offscreen/older records remain in personal history. Saved badges
follow the existing street-score layer state and adapt to dark/light themes.
The tooltip identifies the saved visit and timestamp so historical scores are
not mistaken for a fresh/live assessment.

Click, Enter or Space opens that saved visit through the existing report flow;
it never selects a new address or recomputes the historical CLS. Existing report
weather refresh behavior is unchanged. With paginated history, only records
already loaded/cached appear; loading more in the library populates the overlay
without a separate full-history map download. A full uncached report may load
on explicit selection using the history detail behavior, not on map movement.

Names are inserted as DOM text, not HTML. Personal history, notes, photo keys and
pending synchronization are untouched. Unit/browser CI covers deduplication,
zero/pending/invalid scores, viewport bounds/cap, display precision, keyboard
selection, HTML injection protection, unchanged history and no extra scoring,
history or reverse-geocoding requests from the overlay.
