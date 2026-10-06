# Stable C2–C4 sources

## Activate

1. Obtain a personal API key from https://data.moenv.gov.tw/paradigm and set `MOENV_API_KEY` in the Render server environment. The key stays on the server. Do not put it in frontend code or commit it.
2. Deploy the feature branch after review. Existing GitHub secrets `STREETLENS_REFRESH_URL` (or `STREETLENS_BASE_URL`) and `STREETLENS_REFRESH_TOKEN` authorize the import; no direct database credentials are needed in GitHub.
3. Run the **Weekly static OSM fallback** workflow manually once; later it runs Monday at 02:45 Taipei. It downloads the Taiwan PBF on the GitHub runner, filters it, then uploads only the compact inventory. Failed extraction/upload preserves the previous inventory.
4. Run the existing data refresh workflow. `taipei_official_aqi` now prefers national MOENV AQX_P_432, then the legacy Taipei feed. The currently configured refresh schedule is every six hours, even though the source itself updates hourly.
5. Verify `/api/assessment` and the Sources panel; the static source is `osm_static_taipei`, and AQI provenance names MOENV. Live AQI requires a configured key; mock tests do not prove upstream availability.

## Coverage and precision

OSM bounding box: longitude 121.45–121.67, latitude 24.95–25.22. This is a first Taipei-area extract, not all Taiwan or every part of Taipei City. Overpass continues outside the interior coverage and when the extract is older than 30 days. Within the covered interior, a fresh extract replaces repeated per-location Overpass refreshes. Google Places enrichment remains in place. No claims of complete business coverage are made.

Included categories: supermarkets, convenience stores, clinics/hospitals/doctors/dentists, schools, banks/post offices, markets, parks, bus stops, rail stations and community/library facilities. Node coordinates are original OSM points. Area coordinates are Shapely representative points inside the original OSM polygon, explicitly labelled `polygon_representative_point`; distances are straight-line distances to that representative point, not walking distances or park entrances. Display precision does not reduce stored coordinate precision.

Raw OSM identities deduplicate overlapping static and Overpass features. Malformed upstream polygon areas with no usable geometry are skipped and their count is reported by the extractor; valid features continue. Names come from OSM tags; unnamed features retain an empty name. Attribution: © OpenStreetMap contributors, ODbL; https://www.openstreetmap.org/copyright. The full PBF never enters Neon or Render.

## Failure and storage behavior

The import requires 10–30,000 valid, unique features, at least one park, a recent source timestamp, the documented bounding box, and an upload under 8 MB. It rejects older versions and a reduction below half the existing point count, for investigation rather than silent partial replacement. Points and their snapshot manifest are written in one transaction under a refresh lock. Rollback protects the last-good inventory on write failure. Only this replaceable external source is replaced; personal assessments/photos are never deleted. The existing 700 MB storage guard still applies.

Empty/error citywide responses no longer replace last-good inventories. Static extracts older than 30 days and station AQI older than 24 hours are retained but excluded from scoring. Open-Meteo model AQI remains a separately labelled fallback, usable for up to 48 hours; it is not presented as station measurement. The Sources panel marks expired static/AQI snapshots and shows source update time.

## Validation

`npm run ci` includes adapter/import validation and mocked transaction rollback tests. `python scripts/test-static-osm.py` verifies actual OSM node/area extraction with test-only geometry (requires `osmium==4.3.1 shapely==2.1.2`); GitHub CI also runs it. `npm run check:external-data` remains separate and reports a missing MOENV key as a skipped live check, not a pass.

Local live extraction verification on 2026-10-07 Taipei: Geofabrik source timestamp `2026-10-05T20:21:35Z`, 16,936 features (1,572 parks), compact JSON 2,534,135 bytes, one malformed upstream area skipped. Validation accepted the real extract. This confirms extraction and payload compatibility, not a production DB import or long-term source availability. A live MOENV check was not possible without `MOENV_API_KEY`.
