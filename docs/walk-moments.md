# Field observations and delayed CLS

## User flow

Open **環境觀察** beside the account menu, or **開始實勘** from the CLS panel. Both open the structured field-observation view for the selected map location, separate from the CLS read view. Rate conditions actually observed, continue to review, optionally add notes or evidence photos, and explicitly save the assessment.

The dock 實勘 button opens the GPS-confirmed feeling/photo panel. New photos stay in IndexedDB and only metadata syncs. Old `?mode=walk` URLs open the normal map and never record a visit. Existing saved visits, feeling metadata, favorites and photos are preserved; no data cleanup or migration deletes them. Evidence photos in the assessment save flow remain available.

## CLS loading recovery

A pending HTTP 202 no longer leaves the map score permanently blank. The UI distinguishes loading, pending data and request/database errors, provides a retry button, and rechecks persisted data every 30 seconds while visible/online, plus on resume/reconnect. Assessment requests time out after 20 seconds; reverse-geocoding has a 5-second timeout so an unavailable address service cannot block CLS indefinitely. This does not run external refresh jobs or fabricate a missing score. Saved historical totals render even for older records without a full assessment snapshot.

Favorites now create a saved street if one does not exist. Older favorite-only keys migrate locally without inventing a score. Missing scores display **CLS 待補** and retry in a bounded sequential queue every 30 seconds while the app is visible/online; focus and reconnect also trigger a check. This reads persisted source data and does not call source-refresh jobs. Data availability still depends on the existing refresh pipeline.

`POST /api/assessments/:id/score?workspaceId=...` loads the stored coordinates and ratings, computes the source-backed result with the same assessment loader, then fills a missing score in a transaction. It accepts no client score. The update never replaces photo/evidence rows, retains the visit timestamp, notes and name, and rechecks the row after locking. Already-scored historical visits stay unchanged. Local-only records use the same backend baseline and field-adjustment endpoints before syncing.

## Validation

`npm run ci` retains score, assessment-policy, snapshot-preservation, saved-score and browser checks. Browser regressions verify that URLs and keys outside field mode cannot save a visit or open a camera, the environment-observation entry remains accessible, favorites and delayed CLS still work, and existing records survive reloads. The tests use synthetic fixtures confined to the test process.

Native camera capture and HEIC decoding in the assessment evidence workflow still require a physical-device smoke test. For a read-only capacity report, see [storage-budget.md](storage-budget.md).
# Street Library grouping and missing CLS

Street Library shows one card per coordinate rounded to five decimal places
(about one metre). Different reverse-geocoded names do not create duplicate
cards. The card opens the most recent visit with a completed CLS, or the newest
visit when none is scored. Expand the card to open every original visit.
Grouping is presentation-only: IDs, photographs, notes, feelings and historical
scores remain intact. Deleting a visit deletes that visit, not its whole group.

The visible website retries missing/local saved scores every 30 seconds and on
reconnect. Scheduled data-refresh workflows now run `npm run backfill:scores`
after refreshing sources, including when another refresh step fails. The
six-hour workflow therefore fills remotely stored pending visits even when the
browser is closed. Browser-only visits must first synchronize while the browser
is open. The internal endpoint requires the refresh bearer token and processes
20 pending records per page, using a cursor so unavailable early records do not
starve later ones. Completed scores are never recomputed. Missing source data
stays pending; errors and storage-limit failures are reported, not converted to
zero or a synthetic score.

The CLS map status is inside the search toolbar, can be closed manually and
automatically disappears six seconds after selecting a location. Hiding it does
not mark data as ready or hide the report's pending-data state.
