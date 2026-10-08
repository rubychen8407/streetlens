# Refresh failures, 2026-10-07

Manual run 37568278134 and scheduled run 37578873265 failed on the same
required sources: repeated HTTP 502 for `taipei_street_lights` and an error
snapshot for `taipei_sidewalk_areas`. The old client printed only error counts,
so the exact sidewalk error is not recoverable from those logs. Both sidewalk
calls ended after about 30 seconds, matching the old adapter deadline.
Parks also failed but is already an explicitly optional source. Bicycle lanes
were successfully imported by the manual run and skipped by cadence afterwards.
Backfill exited successfully but scanned zero records; that is not evidence that
saved scores were updated.

## Changes

- Parse the street-light CSV incrementally instead of holding the entire text,
  all raw row arrays, all mapped rows, and all output points simultaneously.
  Only output points and the current CSV record are retained. UTF-8, BOM, CRLF,
  embedded newlines, escaped quotes and chunk boundaries are covered by tests.
- Serialize only colliding spatial IDs when deduplicating. Exact repeats and
  deterministic hashed IDs for conflicting observations keep their semantics.
- Empty numeric CSV cells remain missing, not zero. Invalid or truncated CSV
  fails the whole adapter so existing persisted inventories remain intact.
- Increase each WheelRoute download deadline from 30 to 90 seconds. Invalid
  JSON in either facility feed fails the combined inventory rather than
  replacing it with the successfully parsed subset.
- Retry transient source failures reported inside HTTP 200 (timeouts/network
  errors) up to three attempts. Keep mandatory failures fatal after exhaustion.
  Log bounded source errors and whether existing data were preserved.
- Cover response-body reads with the client deadline. Abort a stalled request
  without starting an overlapping replacement request. Cancel proxy error
  bodies rather than downloading embedded HTML assets. Reject missing snapshot
  results, except the explicit zero-target no-op response.

## Local evidence and limits

Downloaded the official 15,635,429-byte CSV, not a fabricated inventory. Both
implementations parsed 145,919 points with the same latest source timestamp.
Before the empty-cell correction, the complete ordered point fingerprints were
identical. On this Node runtime, parsing alone peaked at 517,316 versus 244,396
KiB RSS. Including both normalization passes peaked at 633,876 versus 348,316
KiB RSS (about 619 versus 340 MiB). These are isolated local process measurements,
not Render memory telemetry or a guarantee about total production memory.
The 502 root cause still needs Render runtime logs or a successful production
refresh to confirm; the implementation demonstrably removes memory pressure.

No new secrets or workflow schedules are required. Deploy the new server before
running **Data refresh → Run workflow → main**. Rerunning an old job uses its old
client revision. The two workflows still share the same concurrency group.
Persistent official-source outages remain errors; retries do not create data.
