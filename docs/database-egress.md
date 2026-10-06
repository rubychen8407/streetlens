# Database transfer budget

Neon egress is data returned from Postgres to the server, not just JSON returned
to the browser. A database-backed snapshot is not a process-local read cache.

## Read paths

- Green references return JSON array lengths; safety references return accident
  counts and maximum flood depths. Full tree/accident arrays stay in Postgres.
- POI/transit/air-quality references share one compact snapshot read containing
  only fields used for deduplication, categories and distances. Missing fields
  remain distinct from explicit nulls. Official POIs remain in the reference set.
- Point count/sum/distance references return scalar aggregates per active target
  rather than returning every point and all its properties. Existing bounding
  boxes, distance ordering and row limits are preserved.
- Nearby snapshot radius filtering occurs in SQL before payloads are returned.
- Refresh cadence, validator and hash checks use snapshot metadata without payload.
- Local green and safety snapshots project 800m tree counts and 500m accident
  count/fatal/injury counts in PostgreSQL before leaving the database. The same
  candidate snapshots and overlapping-record multiplicity are retained; this
  optimization does not silently deduplicate records or change the CLS model.
- Street-light quantity sums, AED/hydrant counts and cooling-point counts are
  read in a single scalar query with the original radii, bounding boxes and
  point limits. Invalid street-light quantities still default to one, while an
  explicit null is zero (matching the existing JS calculation).
- Other assessment point reads project only the properties required by scoring:
  YouBike availability/active status and AQI/PM2.5/publication time. Other source
  properties remain stored, but are not sent for every assessment.

### Accident detail compatibility

The current UI does not consume `c1TrafficAccidents`. Normal assessment responses
now omit this optional raw-detail field instead of downloading every record.
Clients needing it can request `/api/assessment?...&includeAccidents=true`.
The details remain real persisted records, filtered to the same 500m radius;
the flag changes only detail loading, not the calculated scores. The cache key
includes this flag. Historical saved snapshots and source data are untouched.

## Cache and freshness

Reference results and compact input rows use a bounded, process-local 5-minute
cache. Overlapping requests share an in-flight read. Successful assessments are
cached for 60 seconds, keyed by exact coordinates and address labels. Pending
and failed assessments are not cached. Rejected reads are evicted.

Snapshot changes, successful spatial source replacements and cache pruning
invalidate caches. New assessment targets also invalidate cached references.
Updating an existing target's coordinates within its scope may take up to five
minutes to affect global normalization references. Invalidation prevents an old
in-flight result from repopulating the cache. Each server process has its own
cache; other processes see changes within the TTL. Restarts start with empty caches.

Caches contain real persisted source data only. No scores or source values are
invented; no history, favorites, evidence or database rows are deleted by this change.

## Retry and operations

Pending/error reads and saved-score synchronization retry with delays of 30s,
60s, 120s, 240s, 480s, then at most once every 15 minutes while visible/online.
Focus/reconnect does not bypass the cooldown. Manual assessment retry remains
available. Saved deletion retry behavior is unchanged.

The six-hour workflow is the only automatic data refresh schedule. The other
workflow is manual-only; both share a concurrency group so they cannot overlap.
Refresh source cadences still determine which sources are due.

Render liveness uses `/api/live` (no database access). `/api/health` remains a
database readiness diagnostic and can return 503 during a database outage.
For an existing Render service not managed by Blueprint updates, manually set
**Settings → Health Check Path → `/api/live`** after deploying this branch.

This does not reset an exhausted Neon quota. Restore database access separately
and monitor the Network transfer usage trend after deployment. No production
percentage reduction is claimed without measuring actual traffic.

### Safe transfer observability

Set `STREETLENS_DB_TRANSFER_METRICS=true` in Render to emit one-minute aggregate
`db_transfer_metrics` events. Blueprint configuration enables it; an existing
non-Blueprint service needs the environment variable set manually. Disable it
with `false` if measurements are no longer needed.

Events contain only fixed operation names, query/error counts, returned row
counts, `estimatedResultBytes` and total duration. No SQL, parameters, locations,
workspace IDs, record IDs, credentials or row contents are logged. This observes
the scoring/cache read paths, not every transaction/history/photo query.

`estimatedResultBytes` is the UTF-8 JSON size of result rows, not PostgreSQL wire
traffic or Neon billing bytes. Use it to identify large/repeated result sets,
then compare the trend with Neon Network transfer. The flushing timer performs
no database requests and does not keep a Neon compute awake. Measurement or
logging failures do not change query results.

## Verification

`npm run test:egress-budget` executes real PostgreSQL queries in an isolated PGlite
database and checks projections, aggregates, deduplication, official enrichment,
missing/null semantics, warm-cache query counts, freshness invalidation and retry
backoff, plus local-radius/count parity, optional accident detail reads, required
point property projection and privacy-safe metrics. It is included in local CI
and GitHub CI. Fixture data never reaches production.
