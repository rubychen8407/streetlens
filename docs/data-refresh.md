# StreetLens data refresh architecture

StreetLens does not crawl scoring data during a user assessment request.

## Flow

External sources -> scheduled refresh (GitHub Actions) -> PostgreSQL external_data_snapshots -> /api/assessment reads cached snapshots only.

A user request registers the requested coordinate as an assessment target. It does not trigger external crawling.

## Refresh cadence

The scheduled job runs daily at 03:20 Asia/Taipei.

| Source | Cadence |
| --- | --- |
| Google Places | daily |
| OpenStreetMap / Overpass | daily |
| TDX transit | daily |
| Open-Meteo air quality | daily |
| Taipei green/tree data | weekly |
| Taipei traffic/crime safety data | weekly |
| Taipei flood hazard model | weekly |

The refresh endpoint checks each source's cached fetched_at timestamp. A source is skipped until its cadence is due.

After a due source is fetched, StreetLens hashes the normalized payload. If the content hash is unchanged, the database row is not updated. This prevents meaningless database churn when an upstream source has not changed.

For sources that expose HTTP validators, a future adapter iteration should also persist and send ETag / Last-Modified with conditional requests.

## No-fake-data rule

- No synthetic values.
- No random values.
- No regional estimates as street-level measurements.
- Missing or stale data stays unavailable.
- Scores are calculated only from persisted source-backed data.
- Every cached source retains its source key, status, fetch time and content hash.

## Required GitHub Actions secrets

- STREETLENS_BASE_URL: deployed StreetLens base URL.
- STREETLENS_REFRESH_TOKEN: same secret configured on the server.

## Required runtime environment

- DATABASE_URL
- STREETLENS_REFRESH_TOKEN
- Existing external API credentials required by the individual adapters.
