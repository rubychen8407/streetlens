# WheelRoute sidewalk parsing

The official facility endpoints publish kinds 11/12 as records with `kind`,
`kname`, and a `location` string of alternating longitude/latitude tokens
separated by `|`, commonly with a trailing delimiter. On 2026-10-07, bounded
diagnostics counted 15,291 kind-11 and 3,529 kind-12 records. The old GeoJSON-only
parser ignored these records and reported an empty citywide inventory.

The parser preserves every valid source vertex and its numeric precision.
GeoJSON ring closure only repeats the first observed vertex. Odd/missing/
non-finite/out-of-range coordinates, rings with fewer than three distinct
vertices and non-polygon facility
kinds are rejected, not reconstructed. `kname` supplies source identity/name.
Exact repeated records deduplicate; conflicting records keep distinct content.

Native width/slope values are preserved as `sourceWidth` / `sourceSlope` without
assuming units or turning the provider's -1 sentinel into a measurement. This
change uses polygon coverage only, not invented width or slope measurements.
Existing GeoJSON support remains. Empty/error responses still preserve old
snapshots and report failure. Parsing fixtures never supply production data.

Verification: `npm run test:wheelroute-parser` plus the full `npm run ci`.
Source health and the next persisted refresh are separate production checks.
