# External refresh reliability

- Public toilets and AED feeds are retired: no adapters, scheduled calls,
  assessment reads, normalization queries or active UI metrics. Legacy optional
  fields remain readable; personal visits, notes and photos are not deleted.
- AED no longer contributes to C1. `street-anchor-v2-no-aed` invalidates old
  cached baselines. Saved-history overlays accept only the current scoring
  version; old payloads cannot overwrite current saved scores. Retired snapshots
  do not invalidate current baselines.
- Exact duplicate spatial rows collapse before replacement. Distinct rows
  sharing an upstream ID retain their content under deterministic hashed IDs.
  Snapshot inventory counts use the same normalization as database writes.
- Line and area inserts bind PostgreSQL `$n` parameters, including JSONB and
  geometry parameters. Replacements retain transaction rollback protection.
- One scheduled workflow owns the cadence. The manual workflow shares its
  concurrency group and URL-secret fallback. Neither cancels an active refresh.
- HTTP 502/503 retries allow longer recovery; failed response streams are
  released. Gateway HTML is not dumped into logs. Required failures still
  produce a nonzero exit; old snapshots are not treated as successful refreshes.

Tests: `test:spatial-inventory` runs PostgreSQL via PGlite for duplicate IDs,
multiple batches and rollback. Geometry is stubbed as text, so this does not
verify PostGIS spatial semantics. `test:refresh-client` uses a local HTTP server
to verify source exclusion, retries, continued processing and failure exits.

Deployment verification remains separate from CI: Render 502 responses cannot
be attributed to a specific process/resource issue without its runtime logs.
Observe the next scheduled action after deploying the matching server build;
do not repeatedly force citywide refreshes to test deployment readiness.
