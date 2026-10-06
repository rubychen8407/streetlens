# Shared external CLS and visit adjustment

The current rule is `final CLS = clamp(latest shared external CLS + recorded visit adjustment, 0, 100)`. A saved total is a derived cache, not a frozen historical score. Visit IDs, coordinates, timestamps, observations, notes and evidence remain intact.

## Street portions

Normalize whitespace, 台/臺 and city/district prefixes. A named street uses the first actual requested coordinate as its persisted anchor. Requests within 250 metres of an existing same-name/city anchor reuse it; longer roads have separate portions. This is a bounded proximity policy, not authoritative road-topology matching. Lanes/sections and different street names are not collapsed. Missing/unknown street names remain coordinate-scoped. The selected visit coordinate is returned unchanged; the response's `baseline.anchor` identifies the external evidence sampling point.

## Stable source versions

One latest `street_baselines` row per portion stores the shared result and reference-population outcome. Source content hashes, source versions/update dates and availability-expiry transitions invalidate the result. Target registration, reading, `checked_at` and newly visited reference samples alone do not. Bump `BASELINE_SCORING_VERSION` when scoring rules change. The same version returns the same baseline; first committed calculation wins concurrent requests. Source transitions detected during calculation return 202 rather than persisting a mixed-version score. No external acquisition happens on reads.

## Saved visits

Keep `fieldAdjustment` unchanged when rebasing. Legacy records with baseline/final pairs can recover their difference; total-only records cannot recover unknown adjustment points and receive zero unless a new questionnaire is completed. Pending questionnaires still require backend bounded adjustment before their first score. Completed records do not re-run questionnaires merely because external data changes. Clamp the displayed final result but retain adjustment points for future baselines.

Opening a saved visit reads the latest shared baseline. The response updates all matching local visits for library/compare display, without per-visit external queries or new polling. The saved-library endpoint overlays previously computed shared baselines in one database query, without rewriting evidence. Library rows are last-known shared results until that portion's latest baseline has been calculated; this implementation does not promise background regeneration for unvisited portions. Unavailable reads retain existing records; never generate a substitute external score.

The new table is covered by the 700 MB write guard and stores only the latest version per portion. No historical visits or photo bytes are deleted. Production SQL/deployment needs verification on the configured database; deterministic mocks do not certify production activation.
