# Quick walk and delayed CLS

## User flow

Open the footprints button beside the account menu. The search/toolbar row retains its original dimensions. Wait for GPS, verify the map position, then tap **位置正確，開始**. There is no questionnaire.

- **喜歡這裡** records a positive feeling and adds that point to favorites.
- **不喜歡** records a negative feeling without adding a favorite or removing an earlier one.
- **拍照留存** opens the device camera/file capture UI and saves a photo-only visit. Its location/time are frozen when opening the camera, not inferred from EXIF or the location after returning. Photos do not imply a positive/negative feeling.

The location must be no older than 20 seconds and report accuracy within 50 meters. Moving over 35 meters from the confirmed location or leaving the page requires another confirmation. These thresholds are product defaults, not a guarantee that GPS identifies the correct street. GPS denial, stale fixes, storage failures and unsupported/oversized images have explicit failure states. There is no automatic recording from a URL, an orientation gesture or a GPS callback.

Records are saved to localStorage and photos to IndexedDB before success is shown. Synchronization runs in the background. `已存於此裝置，等待同步` means there is not yet a confirmed server copy; clearing browser storage can remove unsynced records. Reconnect/focus resumes retries while the app is open. This is not an offline map or a background iOS app.

## iPhone shortcut

The in-app **iPhone 快捷入口** exposes the current app URL with `?mode=walk`. Create an Apple shortcut with **Open URLs**, then assign it to the Action Button (supported models) or Back Tap. It opens the walking panel; after confirming GPS, one tap records a feeling or invokes camera capture. Web permissions and camera UI still require interaction. Raising the phone alone is not implemented as a native background trigger.

Official setup references:

- [Action Button shortcuts](https://support.apple.com/en-qa/guide/shortcuts/apdfea15680b/ios)
- [Back Tap shortcuts](https://support.apple.com/en-ca/guide/shortcuts/apd897693606/ios)
- [HTML capture behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)

## Relationship to CLS

Walk feelings are personal observations with a timestamp, GPS accuracy and confirmed location. They are displayed beside CLS, not converted into a pseudo-objective 0/100 score. Existing structured field ratings continue using the backend's bounded adjustment. A photo alone never changes CLS.

Favorites now create a saved street if one does not exist. Older favorite-only keys migrate locally without inventing a score. Missing scores display **CLS 待補** and retry in a bounded sequential queue every 30 seconds while the app is visible/online; focus and reconnect also trigger a check. This reads persisted source data and does not call source-refresh jobs. Data availability still depends on the existing refresh pipeline.

`POST /api/assessments/:id/score?workspaceId=...` loads the stored coordinates and ratings, computes the source-backed result with the same assessment loader, then fills a missing score in a transaction. It accepts no client score. The update never replaces photo/evidence rows, retains the visit timestamp, notes and name, and rechecks the row after locking. Already-scored historical visits stay unchanged. Local-only records use the same backend baseline and field-adjustment endpoints before syncing.

## Validation

`npm run ci` runs the original CI gates plus `test:walk-moments` and `test:walk-ui`. Browser tests use explicit synthetic API/GPS fixtures confined to the test process: no mock results enter product data. The suite exercises mobile and desktop layout, denied/stale/moved GPS, duplicate taps, favorites, photo location locking, delayed CLS, reload persistence, quota failure and watcher cleanup. Native iPhone camera, HEIC decoding and Action Button execution still need a physical-device smoke test after deployment.

For database capacity recommendations and a read-only diagnostic command, see [storage-budget.md](storage-budget.md).
