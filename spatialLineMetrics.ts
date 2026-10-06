import { referenceReadCache } from './readCache';

type Query = (sql: string, values: any[]) => Promise<{ rows: any[] }>;
export interface LineMetric { scopeKey: string; count: number; lengthMeters: number }

/** Keep the original geography radius, nearest-row limit and whole-line length.
 * Do not clip lines to the search circle: that would change existing scores. */
export async function readLineMetrics(query: Query, source: string, radius: number, limit: number,
  location?: { lat: number; lng: number }): Promise<LineMetric[]> {
  const targets = location
    ? `SELECT ''::text AS scope_key, $4::double precision AS latitude, $5::double precision AS longitude`
    : `SELECT scope_key, latitude, longitude FROM assessment_targets
       WHERE active = TRUE ORDER BY last_requested_at DESC`;
  const result = await query(`
    SELECT t.scope_key AS "scopeKey", m.count, m.total AS "lengthMeters"
    FROM (${targets}) t
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS count, COALESCE(SUM(CASE
        WHEN length NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
          THEN length ELSE 0 END), 0) AS total
      FROM (
        SELECT ST_Length(geom::geography) AS length,
          ST_Distance(geom::geography, ST_SetSRID(ST_Point(t.longitude, t.latitude), 4326)::geography) AS distance
        FROM external_spatial_lines
        WHERE source_key = $1 AND ST_DWithin(geom::geography,
          ST_SetSRID(ST_Point(t.longitude, t.latitude), 4326)::geography, $2)
        ORDER BY distance ASC LIMIT $3
      ) nearest_lines
    ) m`, location ? [source, radius, limit, location.lat, location.lng] : [source, radius, limit]);
  return result.rows.map(row => ({ scopeKey: row.scopeKey, count: Number(row.count), lengthMeters: Number(row.lengthMeters) }));
}

export function readReferenceLineMetrics(query: Query, source: string, radius: number, limit: number) {
  return referenceReadCache.get('line-metrics' + JSON.stringify([source, radius, limit]),
    () => readLineMetrics(query, source, radius, limit));
}
