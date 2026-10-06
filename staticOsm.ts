import { STATIC_MAX_AGE_MS, STATIC_OSM_SOURCE, isSourceFresh } from './sourceFallbacks';
import { dataDb, hashPayload } from './db';

export function validateStaticImport(body: any) {
  if (!body || body.source !== 'https://download.geofabrik.de/asia/taiwan.html'
    || !isSourceFresh(body.sourceUpdatedAt, STATIC_MAX_AGE_MS)
    || !Array.isArray(body.points) || body.points.length < 10 || body.points.length > 30000) {
    throw new Error('Invalid or empty static OSM extract');
  }
  const ids = new Set<string>();
  const allowed = new Set(['supermarket', 'convenience', 'clinic', 'school', 'bank_post', 'market', 'park', 'bus', 'rail', 'community']);
  const points = body.points.map((point: any) => {
    if (typeof point.id !== 'string' || !/^[nwr]\d+$/.test(point.id) || ids.has(point.id)
      || typeof point.name !== 'string' || point.name.length > 250
      || typeof point.lat !== 'number' || typeof point.lng !== 'number'
      || !(point.lat >= 24.95 && point.lat <= 25.22 && point.lng >= 121.45 && point.lng <= 121.67)
      || !allowed.has(point.properties?.amenityType)
      || !['node', 'polygon_representative_point'].includes(point.properties?.coordinateMethod)) {
      throw new Error('Invalid static OSM feature');
    }
    ids.add(point.id);
    return { id: point.id, name: point.name, lat: point.lat, lng: point.lng,
      properties: { amenityType: point.properties.amenityType,
        coordinateMethod: point.properties.coordinateMethod, source: 'OpenStreetMap / Geofabrik' } };
  });
  if (!points.some((point: any) => point.properties.amenityType === 'park')) throw new Error('Static extract has no parks');
  return { points, sourceUpdatedAt: new Date(body.sourceUpdatedAt).toISOString() };
}
export async function persistStaticImport(body: unknown) {
  const extract = validateStaticImport(body);
  if (!dataDb) throw new Error('Persistent database is not configured');
  const payload = { source: 'OpenStreetMap / Geofabrik', pointCount: extract.points.length,
    attribution: '© OpenStreetMap contributors, ODbL', coverage: [121.45, 24.95, 121.67, 25.22] };
  const version = hashPayload(extract.points);
  const client = await dataDb.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(739202, 1)');
    const existing = await client.query('SELECT source_version, source_updated_at, payload FROM external_data_snapshots WHERE source_key = $1 AND scope_key = $2', [STATIC_OSM_SOURCE, '__citywide__']);
    if (existing.rows[0]?.source_updated_at && new Date(existing.rows[0].source_updated_at).getTime() > Date.parse(extract.sourceUpdatedAt)) throw new Error('Refusing older static extract');
    if (extract.points.length < (Number(existing.rows[0]?.payload?.pointCount) || 0) * 0.5) throw new Error('Refusing unexpectedly incomplete static extract');
    if (existing.rows[0]?.source_version === version) {
      await client.query('UPDATE external_data_snapshots SET checked_at = NOW(), source_updated_at = $2 WHERE source_key = $1 AND scope_key = $3', [STATIC_OSM_SOURCE, extract.sourceUpdatedAt, '__citywide__']);
      await client.query('COMMIT');
      return { changed: false, pointCount: extract.points.length };
    }
    // Only the replaceable external extract is replaced; personal history is untouched.
    await client.query('DELETE FROM external_spatial_points WHERE source_key = $1', [STATIC_OSM_SOURCE]);
    await client.query(`INSERT INTO external_spatial_points (source_key, feature_id, name, latitude, longitude, properties, fetched_at, source_updated_at, source_version)
      SELECT $1, p.id, p.name, p.lat, p.lng, p.properties, NOW(), $3::timestamptz, $4 FROM jsonb_to_recordset($2::jsonb) AS p(id text, name text, lat float8, lng float8, properties jsonb)`, [STATIC_OSM_SOURCE, JSON.stringify(extract.points), extract.sourceUpdatedAt, version]);
    await client.query(`INSERT INTO external_data_snapshots (source_key, scope_key, payload, content_hash, status, fetched_at, checked_at, source_updated_at, source_version, freshness_method)
      VALUES ($1, '__citywide__', $2::jsonb, $3, 'available', NOW(), NOW(), $4, $5, 'source_updated_at')
      ON CONFLICT (source_key, scope_key) DO UPDATE SET payload = EXCLUDED.payload, content_hash = EXCLUDED.content_hash, status = 'available', fetched_at = NOW(), checked_at = NOW(), source_updated_at = EXCLUDED.source_updated_at, source_version = EXCLUDED.source_version, freshness_method = 'source_updated_at'`, [STATIC_OSM_SOURCE, JSON.stringify(payload), hashPayload(payload), extract.sourceUpdatedAt, version]);
    await client.query('COMMIT');
    return { changed: true, pointCount: extract.points.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export function staticPointsToPois(points: any[]) {
  return points.map(point => ({ ...point, amenityType: point.properties.amenityType,
    category: ['rail', 'bus'].includes(point.properties.amenityType) ? 'C3' : point.properties.amenityType === 'park' ? 'C4' : point.properties.amenityType === 'community' ? 'C5' : 'C2',
    source: 'OpenStreetMap / Geofabrik', sourceType: 'open', retrievedAt: point.fetchedAt,
    note: point.properties.coordinateMethod === 'polygon_representative_point' ? 'OSM polygon representative point; not an entrance' : 'OSM mapped point' }));
}
