# Saved street ribbons

Road geometry is independent of CLS. The weekly Geofabrik worker follows source redirects, extracts mapped Taipei road centre lines, preserves real unnamed lanes, and imports geometry and POIs in one transaction. A main push changing this pipeline also runs the import after waiting for the new Render API. The full PBF is downloaded in GitHub Actions, never by a map request or through Render/Neon.

`POST /api/saved-street-geometry` reads the persisted inventory for at most 200 saved street locations in a single bounded spatial lookup. It returns clipped geometry, source revision and timestamp; missing inventory returns 202. No routing, geocoding or external source calls occur in the request. The map makes a batch read only for missing saved geometry, caches up to 200 road pieces locally, and never reads roads on pan/zoom or score-only changes.

Named OSM roads match normalized names, including semicolon-separated aliases, within 60 m. An unnamed mapped lane requires an observed position within 10 m and at least 4 m separation from another candidate. Neighbourhood names and ambiguous junctions keep point labels rather than inventing street shapes. Geometry is clipped within 250 m of the observed visit and does not change any score, field adjustment, visit ID, notes or evidence.

Imports reject stale, truncated, oversized or unexpectedly smaller extracts. Failed replacements roll back; repeated source content updates freshness without rewriting roads. The plain PostgreSQL bounds table works without PostGIS. Check `/api/street-geometry/status` for actual imported road counts before reporting the live feature as ready.
