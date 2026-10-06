# StreetLens 1 GB database budget

The requested ceiling is **1 GB**. StreetLens should keep measured database usage below **700 MB**, leaving at least 300 MB for update churn, migrations and other project allocations. The read-only database report is a database measurement, not a project-wide usage meter.

## What is stored

| Data | Storage rule |
| --- | --- |
| Public source feeds | Fetch on the scheduled refresh, use in CLS calculations, and retain only one current snapshot per source and geographic scope. A changed refresh overwrites that snapshot; refresh history is not accumulated. Citywide feeds keep only the compact source manifest in the snapshot table; spatial rows are the queryable copy. |
| Public-source location caches | Keep the latest input snapshot while active; after 30 days without a request, remove the target and its rebuildable snapshots even when a report exists. The saved report retains its scores and compact provenance. A future request can fetch the public inputs again. |
| Saved assessments | Preserve the CLS scores, score inputs/report payload, provenance, user ratings, notes, favorites and timestamps. These are user history, not disposable cache. |
| Evidence photos | New photo blobs stay in browser IndexedDB; PostgreSQL stores only their evidence metadata. Existing PostgreSQL photo bytes remain readable and are not automatically deleted. Browser cache is device-local and can be lost when site data is cleared. |
| Global reference data | Store one current spatial representation per official dataset; replace it on refresh instead of appending versions. Keep only fields required for calculations, provenance and map display. |

Cache pruning is disabled by default for a non-destructive rollout. Set `STREETLENS_ENABLE_CACHE_PRUNE=true` only after reviewing the database storage report; this enables 30-day target-cache pruning before refresh. It never deletes saved assessments, evidence metadata/photos, or citywide source tables. The 30-day cache can be rebuilt from public sources; a cache miss remains pending until refreshed and must not be interpreted as zero.

## Calculation and persistence flow

1. Fetch current public source data during the scheduled refresh.
2. Use the single current cache to calculate a source-backed baseline CLS. Field observations remain separate and do not change the baseline.
3. When someone saves a report, preserve its score, calculation inputs, provenance, observations, and evidence metadata as that location's durable history. Keep photo bytes in browser IndexedDB only.
4. Expire public-source caches after 30 idle days, including scopes with saved reports. Re-fetch them when needed; saved CLS reports remain readable without the raw feed cache.

This avoids keeping repeated refresh history or every exploratory location forever, while retaining the inputs needed for fast map scoring and saved-report review. Public availability does not mean a feed can be stored without limit: source terms still apply.

## Measure actual usage

Run `npm run db:storage` with the rebuilt database's `DATABASE_URL`. The read-only command reports database and table/TOAST/index sizes, photo bytes, snapshot sizes by source, assessment payload sizes and pending CLS counts. It does not return photo contents or delete data. Compare database usage with the Neon project usage meter; database size alone does not account for every project-level allocation.

The application currently expires rebuildable caches and does not upload new photo bytes, but the write circuit breaker described below protects application writes but cannot strictly cap all physical PostgreSQL growth. Check the report and project usage after initial import and on each refresh cycle; stop adding bulk public imports if database usage reaches 700 MB. Historical photo bytes already in PostgreSQL are retained. This workspace has no credentials for the rebuilt database, so its current size has not been measured and the ceiling cannot yet be verified.

## Enforced write protection

Startup installs BEFORE/AFTER INSERT/UPDATE statement triggers on all nine application tables (optional spatial tables when present). At 700,000,000 database bytes, writes fail with STORAGE_WRITE_LIMIT; assessment saves return HTTP 507. Transactions serialize through an advisory lock; a write that crosses the threshold rolls back. Bulk point refreshes use a single checked-out connection so a failed replacement restores the old data. Reads remain available; no historical records are deleted by the guard. Cache pruning remains opt-in.

This is a logical write circuit breaker, not a physical Neon project quota: aborted writes, WAL, bloat, DDL and provider allocations can still consume disk. It does not reclaim space or promise a physical 1 GB ceiling. Deployment must successfully install triggers before API writes run. No live database was available for measurement here.
