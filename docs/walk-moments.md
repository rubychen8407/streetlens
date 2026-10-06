# Field observations and delayed CLS

## User flow

Open **環境觀察** beside the account menu, or **開始實勘** from the CLS panel. Both open the structured field-observation view for the selected map location, separate from the CLS read view. Rate conditions actually observed, continue to review, optionally add notes or evidence photos, and explicitly save the assessment.

The dock 實勘 button opens a full-screen rear-camera preview and automatically starts GPS. Fresh, accurate GPS is accepted without a confirmation button. Bottom controls save liking, disliking or a frame from the live camera. Capture uses the visible centre crop at the moment of the tap, stores JPEG (maximum dimension 1280, at most 2 MB) in IndexedDB, and synchronizes only metadata. It does not open the device camera/file picker or upload the video stream. Camera permission failure allows retry; missing or stale GPS disables recording. Leaving the mode or hiding the page stops camera tracks; returning to the page reopens the preview. Old `?mode=walk` URLs open the normal map and never record a visit. Existing visits and photos remain unchanged.

## CLS loading recovery

Repeated actions in field mode update one record instead of creating a new ID.
The same coordinate (within 2 m), or the same named street/city/district within
35 m, identifies the same field place, accommodating GPS drift without merging
distant segments of a road. The original anchor coordinate and visit time remain;
each photo retains its actual capture coordinate and time. Evidence accumulates
by evidence ID, while a newer feeling or note replaces the same field. Taking a
photo does not reset a selected feeling. Missing CLS from a new field action does
not erase an existing source-backed CLS. Existing separate historical visits are
retained; this is not a destructive historical migration.

Field records carry a monotonic `fieldUpdatedAt`. PostgreSQL locks the saved row,
accepts only newer field revisions and merges metadata in the same transaction.
Identical retries and late uploads cannot overwrite a newer revision. Cloud
responses arriving during another action leave that newer local action queued
for synchronization. Photo bytes and old evidence rows are never deleted by
this update. Ordinary saved assessment retries remain idempotent.

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
