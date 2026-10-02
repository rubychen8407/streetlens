# Quick walk and delayed CLS

## User flow

Open **喜歡／拍照** beside the account menu (visible on mobile and desktop), or use **開始實勘** from the CLS panel. The CLS read view and field-recording mode are separate. Field mode hides the map toolbars and CLS cards, reserves unobstructed map space, and shows only location and recording controls. Optional structured observations remain under **詳細環境觀察** and use the confirmed GPS location. The search/toolbar row retains its original dimensions. Wait for GPS, verify the map position, then tap **位置正確，開始**. There is no questionnaire.

- **喜歡這裡** records a positive feeling and adds that point to favorites.
- **不喜歡** records a negative feeling without adding a favorite or removing an earlier one.
- **拍照留存** opens the device camera/file capture UI and saves a photo-only visit. Its location/time are frozen when opening the camera, not inferred from EXIF or the location after returning. Photos do not imply a positive/negative feeling.

The location must be no older than 20 seconds and report accuracy within 50 meters. Moving over 35 meters from the confirmed location or leaving the page requires another confirmation. These thresholds are product defaults, not a guarantee that GPS identifies the correct street. GPS denial, stale fixes, storage failures and unsupported/oversized images have explicit failure states. There is no automatic recording from a URL, an orientation gesture or a GPS callback.

Records are saved to localStorage and photos to IndexedDB before success is shown. Synchronization runs in the background. `已存於此裝置，等待同步` means there is not yet a confirmed server copy; clearing browser storage can remove unsynced records. Reconnect/focus resumes retries while the app is open. This is not an offline map or a background iOS app.

## Keyboard shortcuts

After GPS confirmation: **1** records a positive feeling, **2** records a negative feeling, **C** opens camera capture. These share the same GPS gates and save path as the buttons; no extra Save action is needed. Key repeats, modifier combinations, text inputs and the shortcut-setup panel do not trigger recording. iPhone hardware shortcuts open the field mode URL; browser permission/camera confirmation still apply.

## CLS loading recovery

A pending HTTP 202 no longer leaves the map score permanently blank. The UI distinguishes loading, pending data and request/database errors, provides a retry button, and rechecks persisted data every 30 seconds while visible/online, plus on resume/reconnect. Assessment requests time out after 20 seconds; reverse-geocoding has a 5-second timeout so an unavailable address service cannot block CLS indefinitely. This does not run external refresh jobs or fabricate a missing score. Saved historical totals render even for older records without a full assessment snapshot.

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
