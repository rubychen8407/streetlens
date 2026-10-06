import { referenceReadCache } from './readCache';

type Query = (sql: string, values: any[]) => Promise<{ rows: any[] }>;
export interface SpatialMetric { scopeKey: string; count: number; nearestDistance: number | null; propertySum: number }

/** Return scalar metrics per target, not every matching point/property. The
 * bounding box, distance ordering and row limit match the existing reader. */
export function readSpatialPointMetrics(query: Query, sourceKey: string, radius: number, limit: number, propertyKey: string | null = null) {
  return referenceReadCache.get('spatial-metrics' + JSON.stringify([sourceKey, radius, limit, propertyKey]), async () => {
    const result = await query(`
      SELECT t.scope_key AS "scopeKey", m.count, m.nearest AS "nearestDistance", m.total AS "propertySum"
      FROM assessment_targets t
      CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE distance <= $2) AS count,
          MIN(distance) FILTER (WHERE distance <= $2) AS nearest,
          COALESCE(SUM(CASE
            WHEN value = 'true'::jsonb THEN 1
            WHEN value = 'false'::jsonb OR value = 'null'::jsonb OR btrim(value #>> '{}') = '' THEN 0
            WHEN value #>> '{}' ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              THEN CASE WHEN abs((value #>> '{}')::numeric) <= 1.7976931348623157e308
                THEN (value #>> '{}')::numeric ELSE 0 END
            ELSE 0 END) FILTER (WHERE distance <= $2), 0) AS total
        FROM (
          SELECT CASE WHEN $4::text IS NOT NULL THEN p.properties->$4 ELSE NULL END AS value,
            6371000 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(p.latitude - t.latitude) / 2), 2) +
              COS(RADIANS(t.latitude)) * COS(RADIANS(p.latitude)) *
              POWER(SIN(RADIANS(p.longitude - t.longitude) / 2), 2))) AS distance
          FROM external_spatial_points p
          WHERE p.source_key = $1
            AND p.latitude BETWEEN t.latitude - $2 / 111320.0 AND t.latitude + $2 / 111320.0
            AND p.longitude BETWEEN t.longitude - $2 / (111320.0 * GREATEST(0.35, COS(RADIANS(t.latitude))))
              AND t.longitude + $2 / (111320.0 * GREATEST(0.35, COS(RADIANS(t.latitude))))
          ORDER BY distance ASC LIMIT $3
        ) nearest_points
      ) m
      WHERE t.active = TRUE ORDER BY t.last_requested_at DESC`, [sourceKey, radius, limit, propertyKey]);
    return result.rows.map(row => ({ scopeKey: row.scopeKey, count: Number(row.count),
      nearestDistance: row.nearestDistance == null ? null : Number(row.nearestDistance),
      propertySum: Number(row.propertySum) })) as SpatialMetric[];
  });
}
