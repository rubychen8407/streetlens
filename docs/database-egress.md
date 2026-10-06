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

## Verification

`npm run test:egress-budget` executes real PostgreSQL queries in an isolated PGlite
database and checks projections, aggregates, deduplication, official enrichment,
missing/null semantics, warm-cache query counts, freshness invalidation and retry
backoff. It is included in local CI and GitHub CI. Fixture data never reaches production.
