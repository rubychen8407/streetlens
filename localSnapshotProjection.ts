export interface LocalSnapshotRead { lat: number; lng: number; includeAccidents?: boolean }

/** Preserve Number(null)/Number(boolean)/decimal numeric-string semantics without
 * transferring raw JSON points. Absent, malformed and non-finite values are NULL. */
export function finiteJsonNumberSql(expression: string): string {
  return `(CASE
    WHEN ${expression} = 'null'::jsonb OR btrim(${expression} #>> '{}') = '' THEN 0::double precision
    WHEN ${expression} = 'true'::jsonb THEN 1::double precision
    WHEN ${expression} = 'false'::jsonb THEN 0::double precision
    WHEN btrim(${expression} #>> '{}') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      THEN CASE WHEN abs((${expression} #>> '{}')::numeric) <= 1.7976931348623157e308
        THEN (${expression} #>> '{}')::double precision END
    END)`;
}

export function localSnapshotPayload(sourceKey: string, payload: string, lat: string, lng: string, includeAccidents = false): string {
  if (sourceKey !== 'taipei_green' && sourceKey !== 'taipei_safety') return payload;
  const array = (name: string) => `CASE WHEN jsonb_typeof(${payload}->'${name}') = 'array'
    THEN ${payload}->'${name}' ELSE '[]'::jsonb END`;
  const nearby = (name: string, radius: number) => `
    SELECT p FROM (
      SELECT p, ${finiteJsonNumberSql("p->'lat'")} AS latitude, ${finiteJsonNumberSql("p->'lng'")} AS longitude
      FROM jsonb_array_elements(${array(name)}) p
    ) points
    CROSS JOIN LATERAL (SELECT
      POWER(SIN(RADIANS(latitude - ${lat}) / 2), 2) +
      COS(RADIANS(${lat})) * COS(RADIANS(latitude)) *
      POWER(SIN(RADIANS(longitude - ${lng}) / 2), 2) AS h
    ) distance
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND 6371000 * 2 * ATAN2(SQRT(LEAST(1, GREATEST(0, h))), SQRT(1 - LEAST(1, GREATEST(0, h)))) <= ${radius}`;
  const provenance = `COALESCE((SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(CASE WHEN jsonb_typeof(${payload}) = 'object' THEN ${payload} ELSE '{}'::jsonb END)
    WHERE key IN ('source', 'status', 'retrievedAt', 'error')), '{}'::jsonb)`;
  if (sourceKey === 'taipei_green') return `(${provenance} || jsonb_build_object(
    'streetTreeCount800m', (SELECT COUNT(*) FROM (${nearby('streetTrees', 800)}) street),
    'parkTreeCount800m', (SELECT COUNT(*) FROM (${nearby('parkTrees', 800)}) park)))`;
  return `(${provenance} || (SELECT jsonb_build_object(
    'accidentCount500m', COUNT(*),
    'fatalAccidentCount500m', COUNT(*) FILTER (WHERE p->>'type' ~ '1類|A1|死亡'),
    'injuryAccidentCount500m', COUNT(*) FILTER (WHERE p->>'type' ~ '2類|A2|受傷')
    ${includeAccidents ? ", 'accidents', COALESCE(jsonb_agg(p), '[]'::jsonb)" : ''}
  ) FROM (${nearby('accidents', 500)}) accidents))`;
}
