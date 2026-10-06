import { referenceReadCache } from './readCache';

type Query = (sql: string) => Promise<{ rows: any[] }>;

// All POI reference consumers share one compact read. Never transfer raw provider
// responses, tags or geometry merely to compute counts/nearest distances.
export function readReferenceSnapshots(query: Query): Promise<any[]> {
  return referenceReadCache.get('reference-snapshots', async () => {
    const result = await query(`
      SELECT scope_key AS "scopeKey", source_key AS "sourceKey",
        CASE
          WHEN source_key IN ('google_places', 'openstreetmap') THEN
            jsonb_build_object('pois', COALESCE((
              SELECT jsonb_agg(COALESCE((SELECT jsonb_object_agg(key, value)
                FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END)
                WHERE key IN ('id', 'name', 'lat', 'lng', 'category', 'amenityType', 'distanceMeters')), '{}'::jsonb))
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'pois') = 'array'
                THEN payload->'pois' ELSE '[]'::jsonb END) p
            ), '[]'::jsonb))
          WHEN source_key = 'tdx_transit' THEN
            jsonb_build_object(
              'stops', COALESCE((SELECT jsonb_agg(CASE WHEN p ? 'distanceMeters'
                  THEN jsonb_build_object('distanceMeters', p->'distanceMeters') ELSE '{}'::jsonb END)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'stops') = 'array'
                  THEN payload->'stops' ELSE '[]'::jsonb END) p), '[]'::jsonb),
              'railStations', COALESCE((SELECT jsonb_agg(CASE WHEN p ? 'distanceMeters'
                  THEN jsonb_build_object('distanceMeters', p->'distanceMeters') ELSE '{}'::jsonb END)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'railStations') = 'array'
                  THEN payload->'railStations' ELSE '[]'::jsonb END) p), '[]'::jsonb))
          WHEN source_key = 'taipei_official_aqi' THEN
            jsonb_build_object('points', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'properties', CASE WHEN (p->'properties') ? 'aqi'
                THEN jsonb_build_object('aqi', p->'properties'->'aqi') ELSE '{}'::jsonb END))
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'points') = 'array'
                THEN payload->'points' ELSE '[]'::jsonb END) p), '[]'::jsonb))
          ELSE CASE WHEN payload ? 'aqi' THEN jsonb_build_object('aqi', payload->'aqi') ELSE '{}'::jsonb END
        END AS payload
      FROM external_data_snapshots
      WHERE source_key IN ('google_places', 'openstreetmap', 'tdx_transit',
        'open_meteo_air_quality', 'taipei_official_aqi')
        AND status IN ('available', 'empty')`);
    return result.rows;
  });
}
