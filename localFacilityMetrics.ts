import { finiteJsonNumberSql } from './localSnapshotProjection';
import { measuredQuery } from './queryTransferMetrics';

type Query = (sql: string, values: any[]) => Promise<{ rows: any[] }>;
export async function readLocalFacilityMetrics(query: Query, lat: number, lng: number) {
  const result = await measuredQuery('facilities.local', () => query(`
    WITH sources(source_key, radius, row_limit) AS (VALUES
      ('taipei_street_lights', 300, 5000), ('taipei_aed', 500, 500),
      ('taipei_fire_hydrants', 500, 1000), ('taipei_cooling_points', 1200, 300))
    SELECT s.source_key AS "sourceKey", m.count, m.total AS "quantitySum"
    FROM sources s CROSS JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE distance <= s.radius) AS count,
        COALESCE(SUM(COALESCE(${finiteJsonNumberSql("properties->'quantity'")}, 1))
          FILTER (WHERE distance <= s.radius), 0) AS total
      FROM (
        SELECT p.properties, 6371000 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(p.latitude - $1) / 2), 2) +
          COS(RADIANS($1)) * COS(RADIANS(p.latitude)) *
          POWER(SIN(RADIANS(p.longitude - $2) / 2), 2))) AS distance
        FROM external_spatial_points p WHERE p.source_key = s.source_key
          AND p.latitude BETWEEN $1 - s.radius / 111320.0 AND $1 + s.radius / 111320.0
          AND p.longitude BETWEEN $2 - s.radius / (111320.0 * GREATEST(0.35, COS(RADIANS($1))))
            AND $2 + s.radius / (111320.0 * GREATEST(0.35, COS(RADIANS($1))))
        ORDER BY distance ASC LIMIT s.row_limit
      ) nearby
    ) m`, [lat, lng]));
  return Object.fromEntries(result.rows.map(row => [row.sourceKey, {
    count: Number(row.count), quantitySum: Number(row.quantitySum),
  }])) as Record<string, { count: number; quantitySum: number }>;
}
