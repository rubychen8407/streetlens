# StreetLens within a 5 GB database budget

The 5 GB limit does not require limiting the map to places already visited. Keep reusable geographic data in one compact spatial representation; keep personal visits separately. Actual capacity must be measured, not inferred from the plan limit.

## Measure first

Run `npm run db:storage` with the deployed database's `DATABASE_URL` (and its existing SSL setting). This command runs a read-only transaction with a 20-second query timeout. It reports database/table/TOAST/index sizes, photo bytes, snapshot sizes by source, and pending CLS count. It neither exports coordinates/photos nor deletes data. This development workspace has no production database credentials, so no production byte counts have been measured here.

## What the current code stores

| Area | Current behavior | Recommended treatment |
| --- | --- | --- |
| `assessment_evidence.photo_data` | JPEG/original photo bytes in PostgreSQL `BYTEA` | First priority: move blobs to a private object bucket, retaining object key, size, MIME type and capture metadata in PostgreSQL. |
| `external_data_snapshots` | One current JSON payload per `(source_key, scope_key)`; matching hashes preserve the version | There is no unbounded row-per-refresh history to purge. Reduce repeated nearby-scope POIs and citywide payload duplication instead. |
| `external_spatial_points/areas/lines` | Queryable official citywide geometry and properties | Retain nationwide/citywide coverage where economical. Keep only fields required by scores, provenance and map displays. |
| Flood geometry | Spatial polygons used for risk queries | Preserve calculation geometry; simplified map geometry may be separate. Do not blindly simplify authoritative boundaries and change safety results. |
| `assessment_sessions.payload` | Assessment snapshot plus personal observations per visit | Preserve personal history. A later migration can deduplicate immutable score snapshots by content hash and reference them from visits. |
| `assessment_targets` | Locations registered for background data collection | Personal saves should pin their scopes; inactive exploratory scopes can expire after a proposed 30–90 days. No TTL is enabled in this change. |

## Recommended order

1. **Reduce new photo size now.** Quick-walk capture uses a 1280-pixel maximum dimension and JPEG quality 0.72 when browser decoding is available, with a 2 MiB hard client limit. Unsupported decoding can retain a smaller original; dimensions and MIME type remain truthful. Compression is lossy. Existing full-assessment evidence behavior is preserved.
2. **Move photos to private object storage.** Use authenticated API/proxy or signed URLs; never public permanent photo URLs. Copy existing bytes, verify checksums/reads, switch references, then remove database blobs in a separately reviewed migration. Do not put object-store credentials in browser code. The existing workspace-ID model is not full user authentication; hardening it should accompany broader sharing.
3. **Remove duplication after checking consumers.** Official citywide imports may be represented both by raw snapshots and spatial rows. Replace duplicated raw feature arrays with a manifest (source/version/hash/count) only after all snapshot consumers have migrated. Nearby Google/OSM scopes should share source entity IDs or a grid cache. This must respect each provider's storage/licensing terms.
4. **Expire reconstructable caches, not personal history.** Propose 30–90 days for unused exploratory scopes, protect favorites/visits and keep citywide source versions. A miss should schedule refresh and be shown as pending; do not turn it into an invented zero. This is a separate change because it affects coverage and source refresh load.
5. **Inspect churn and indexes.** Citywide refresh code replaces rows, potentially generating dead tuples. Measure before changing it to differential upserts. The explicit source/scope index may duplicate the unique constraint's index; verify definitions/dependencies before removal. Ordinary `VACUUM` makes space reusable but generally does not shrink the allocated table file. Plan any rewrite/repack with enough temporary capacity and an appropriate maintenance window.

Illustrative arithmetic only: 10,000 photos × 500 KB ≈ 5 GB before row/index overhead; 100,000 visits × 10 KB ≈ 1 GB before overhead. These are assumptions, not measured StreetLens record sizes. Removing images from PostgreSQL is usually a more direct gain than restricting geographic coverage.

Keep a 20–30% operating margin for indexes, update churn and migrations. Check provider accounting for additional database branches and restore history; `pg_database_size` only measures this database.

## Sources checked 2026-09-25

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/): Standard storage includes 10 GB-month/month free; operation quotas and charges beyond the free allowance still apply.
- [Neon storage cost optimization](https://neon.com/docs/introduction/cost-optimization)
- [Neon pg_repack](https://neon.com/docs/extensions/pg_repack)

No production data has been deleted, migrated to object storage, or subjected to a retention policy by this feature branch.
