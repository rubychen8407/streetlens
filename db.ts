import "dotenv/config";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || "";
const poolConfig = connectionString
  ? {
      connectionString,
      max: 5,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    }
  : null;

export const dataDb = poolConfig ? new Pool(poolConfig) : null;

export interface CachedSnapshot {
  sourceKey: string;
  scopeKey: string;
  payload: any;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  fetchedAt: string;
  checkedAt: string;
  sourceUpdatedAt: string | null;
  sourceVersion: string | null;
  freshnessMethod: "source_updated_at" | "etag" | "last_modified" | "scheduled" | "unknown";
  status: string;
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

let postgisAvailable = false;

export async function ensureDataCacheSchema(): Promise<void> {
  if (!dataDb) return;

  // PostGIS is optional so local/CI environments without the extension can
  // still use the regular snapshot cache. Neon supports PostGIS for spatial
  // point-in-polygon queries used by the flood-risk index.
  try {
    await dataDb.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);
    postgisAvailable = true;
  } catch (error) {
    console.warn("PostGIS is not available; global flood spatial index disabled:", error);
  }

  await dataDb.query(`
    CREATE TABLE IF NOT EXISTS external_spatial_points (
      source_key TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      name TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_updated_at TIMESTAMPTZ,
      source_version TEXT,
      PRIMARY KEY (source_key, feature_id)
    );

    CREATE INDEX IF NOT EXISTS idx_external_spatial_points_source_lat_lng
      ON external_spatial_points(source_key, latitude, longitude);

    CREATE TABLE IF NOT EXISTS assessment_targets (
      id BIGSERIAL PRIMARY KEY,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      scope_key TEXT NOT NULL UNIQUE,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS external_data_snapshots (
      id BIGSERIAL PRIMARY KEY,
      source_key TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      content_hash TEXT NOT NULL,
      etag TEXT,
      last_modified TEXT,
      status TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_updated_at TIMESTAMPTZ,
      source_version TEXT,
      freshness_method TEXT NOT NULL DEFAULT 'unknown',
      UNIQUE (source_key, scope_key)
    );

    ALTER TABLE external_data_snapshots ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE external_data_snapshots ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;
    ALTER TABLE external_data_snapshots ADD COLUMN IF NOT EXISTS source_version TEXT;
    ALTER TABLE external_data_snapshots ADD COLUMN IF NOT EXISTS freshness_method TEXT NOT NULL DEFAULT 'unknown';

    CREATE INDEX IF NOT EXISTS idx_external_data_snapshots_source_scope
      ON external_data_snapshots(source_key, scope_key);
    CREATE INDEX IF NOT EXISTS idx_assessment_targets_active
      ON assessment_targets(active, last_requested_at DESC);
  `);

  if (postgisAvailable) {
    await dataDb.query(`
      CREATE TABLE IF NOT EXISTS flood_hazard_polygons (
        id BIGSERIAL PRIMARY KEY,
        scenario_mmh DOUBLE PRECISION NOT NULL,
        depth_cm DOUBLE PRECISION,
        source TEXT NOT NULL,
        source_version TEXT,
        source_updated_at TIMESTAMPTZ,
        geom geometry(Geometry, 4326) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flood_hazard_polygons_geom
        ON flood_hazard_polygons USING GIST (geom);
      CREATE INDEX IF NOT EXISTS idx_flood_hazard_polygons_scenario
        ON flood_hazard_polygons(scenario_mmh);

      CREATE TABLE IF NOT EXISTS historical_flood_events (
        id BIGSERIAL PRIMARY KEY,
        event_date DATE,
        town_name TEXT,
        address TEXT,
        depth_cm DOUBLE PRECISION,
        area DOUBLE PRECISION,
        source TEXT NOT NULL,
        source_version TEXT,
        source_updated_at TIMESTAMPTZ,
        geom geometry(Polygon, 4326) NOT NULL
      );

      ALTER TABLE historical_flood_events
        ALTER COLUMN geom TYPE geometry(Geometry, 4326)
        USING geom::geometry(Geometry, 4326);

      CREATE INDEX IF NOT EXISTS idx_historical_flood_events_geom
        ON historical_flood_events USING GIST (geom);
      CREATE INDEX IF NOT EXISTS idx_historical_flood_events_date
        ON historical_flood_events(event_date DESC);
    `);
  }
}

export function spatialScopeKey(lat: number, lng: number): string {
  // ~110m latitude cells; all assessment data is explicitly scoped to the cell
  // used to retrieve it. No source-backed value is silently reused globally.
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export async function registerAssessmentTarget(lat: number, lng: number): Promise<string | null> {
  if (!dataDb) return null;
  const scopeKey = spatialScopeKey(lat, lng);
  await dataDb.query(
    `INSERT INTO assessment_targets (latitude, longitude, scope_key, last_requested_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (scope_key)
     DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                   last_requested_at = NOW(), active = TRUE`,
    [lat, lng, scopeKey],
  );
  return scopeKey;
}

export async function listActiveAssessmentTargets(): Promise<Array<{ latitude: number; longitude: number; scopeKey: string }>> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT latitude, longitude, scope_key AS "scopeKey"
     FROM assessment_targets
     WHERE active = TRUE
     ORDER BY last_requested_at DESC`,
  );
  return result.rows;
}

export async function getCachedSnapshot(sourceKey: string, scopeKey: string): Promise<CachedSnapshot | null> {
  if (!dataDb) return null;
  const result = await dataDb.query(
    `SELECT source_key AS "sourceKey", scope_key AS "scopeKey", payload,
            etag, last_modified AS "lastModified", content_hash AS "contentHash",
            fetched_at AS "fetchedAt", checked_at AS "checkedAt",
            source_updated_at AS "sourceUpdatedAt", source_version AS "sourceVersion",
            freshness_method AS "freshnessMethod", status
     FROM external_data_snapshots
     WHERE source_key = $1 AND scope_key = $2`,
    [sourceKey, scopeKey],
  );
  return result.rows[0] || null;
}

export async function getNearbyCachedSnapshots(
  sourceKey: string,
  lat: number,
  lng: number,
  maxDistanceMeters = 900,
  limit = 6,
): Promise<Array<CachedSnapshot & { scopeDistanceMeters: number }>> {
  if (!dataDb) return [];

  const result = await dataDb.query(
    `SELECT s.source_key AS "sourceKey", s.scope_key AS "scopeKey", s.payload,
            s.etag, s.last_modified AS "lastModified", s.content_hash AS "contentHash",
            s.fetched_at AS "fetchedAt", s.checked_at AS "checkedAt",
            s.source_updated_at AS "sourceUpdatedAt", s.source_version AS "sourceVersion",
            s.freshness_method AS "freshnessMethod", s.status,
            6371000 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(t.latitude - $2) / 2), 2) +
              COS(RADIANS($2)) * COS(RADIANS(t.latitude)) *
              POWER(SIN(RADIANS(t.longitude - $3) / 2), 2)
            )) AS "scopeDistanceMeters"
     FROM external_data_snapshots s
     JOIN assessment_targets t ON t.scope_key = s.scope_key
     WHERE s.source_key = $1
       AND s.status IN ('available', 'empty')
     ORDER BY "scopeDistanceMeters" ASC
     LIMIT $4`,
    [sourceKey, lat, lng, limit],
  );

  return result.rows.filter((row) =>
    Number.isFinite(Number(row.scopeDistanceMeters))
    && Number(row.scopeDistanceMeters) <= maxDistanceMeters
  );
}

export async function getNearestCachedSnapshot(
  sourceKey: string,
  lat: number,
  lng: number,
  maxDistanceMeters = 250,
): Promise<(CachedSnapshot & { scopeDistanceMeters: number }) | null> {
  const rows = await getNearbyCachedSnapshots(sourceKey, lat, lng, maxDistanceMeters, 1);
  return rows[0] || null;
}

export interface FloodHazardPolygonRecord {
  scenarioMmH: 78.8 | 100 | 130;
  depthCm: number | null;
  source: string;
  sourceVersion?: string | null;
  sourceUpdatedAt?: string | null;
  coordinates: Array<[number, number]>;
}

function floodPolygonWkt(coordinates: Array<[number, number]>): string | null {
  if (coordinates.length < 3) return null;
  const closed = coordinates[0][0] === coordinates[coordinates.length - 1][0]
    && coordinates[0][1] === coordinates[coordinates.length - 1][1]
    ? coordinates
    : [...coordinates, coordinates[0]];
  return "POLYGON((" + closed.map(([lng, lat]) => `${lng} ${lat}`).join(",") + "))";
}

function historicalFloodGeometryWkt(coordinates: Array<[number, number]>): string | null {
  if (coordinates.length === 1) {
    const [lng, lat] = coordinates[0];
    return `POINT(${lng} ${lat})`;
  }
  return floodPolygonWkt(coordinates);
}

export interface HistoricalFloodEventRecord {
  eventDate?: string | null;
  townName?: string | null;
  address?: string | null;
  depthCm?: number | null;
  area?: number | null;
  source: string;
  sourceVersion?: string | null;
  sourceUpdatedAt?: string | null;
  coordinates: Array<[number, number]>;
}

export async function replaceHistoricalFloodEvents(
  events: HistoricalFloodEventRecord[],
): Promise<boolean> {
  if (!dataDb || !postgisAvailable || !events.length) return false;

  const client = await dataDb.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM historical_flood_events");

    for (let i = 0; i < events.length; i += 50) {
      const batch = events.slice(i, i + 50);
      const values: string[] = [];
      const params: any[] = [];
      let p = 1;

      for (const event of batch) {
        const wkt = historicalFloodGeometryWkt(event.coordinates);
        if (!wkt) continue;

        let eventDate: Date | null = null;
        if (event.eventDate) {
          const parsed = new Date(event.eventDate);
          if (Number.isFinite(parsed.getTime())) eventDate = parsed;
        }

        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, ST_SetSRID(ST_GeomFromText($${p++}), 4326))`,
        );
        params.push(
          eventDate,
          event.townName ?? null,
          event.address ?? null,
          event.depthCm ?? null,
          event.area ?? null,
          event.source,
          event.sourceVersion ?? null,
          event.sourceUpdatedAt ? new Date(event.sourceUpdatedAt) : null,
          wkt,
        );
      }

      if (values.length) {
        await client.query(
          `INSERT INTO historical_flood_events
             (event_date, town_name, address, depth_cm, area, source, source_version, source_updated_at, geom)
           VALUES ${values.join(",")}`,
          params,
        );
      }
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getHistoricalFloodEventsAtPoint(
  lat: number,
  lng: number,
  radiusMeters = 500,
): Promise<Array<{
  eventDate: string | null;
  townName: string | null;
  address: string | null;
  depthCm: number | null;
  area: number | null;
  distanceMeters: number;
  source: string;
}>> {
  if (!dataDb || !postgisAvailable) return [];

  const result = await dataDb.query(
    `SELECT event_date AS "eventDate",
            town_name AS "townName",
            address,
            depth_cm AS "depthCm",
            area,
            source,
            ST_Distance(
              geom::geography,
              ST_SetSRID(ST_Point($2, $1), 4326)::geography
            ) AS "distanceMeters"
     FROM historical_flood_events
     WHERE ST_DWithin(
       geom::geography,
       ST_SetSRID(ST_Point($2, $1), 4326)::geography,
       $3
     )
     ORDER BY "distanceMeters" ASC, event_date DESC NULLS LAST
     LIMIT 20`,
    [lat, lng, radiusMeters],
  );

  return result.rows.map((row: any) => ({
    eventDate: row.eventDate ? new Date(row.eventDate).toISOString().slice(0, 10) : null,
    townName: row.townName || null,
    address: row.address || null,
    depthCm: row.depthCm == null ? null : Number(row.depthCm),
    area: row.area == null ? null : Number(row.area),
    distanceMeters: Number(row.distanceMeters),
    source: row.source,
  }));
}

export async function replaceFloodHazardPolygons(
  polygons: FloodHazardPolygonRecord[],
): Promise<boolean> {
  if (!dataDb || !postgisAvailable || !polygons.length) return false;

  const client = await dataDb.connect();
  try {
    await client.query("BEGIN");

    const scenarios = [...new Set(polygons.map((polygon) => polygon.scenarioMmH))];
    await client.query(
      "DELETE FROM flood_hazard_polygons WHERE scenario_mmh = ANY($1::double precision[])",
      [scenarios],
    );

    for (let i = 0; i < polygons.length; i += 50) {
      const batch = polygons.slice(i, i + 50);
      const values: string[] = [];
      const params: any[] = [];
      let p = 1;

      for (const polygon of batch) {
        const wkt = floodPolygonWkt(polygon.coordinates);
        if (!wkt) continue;
        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, ST_SetSRID(ST_GeomFromText($${p++}), 4326))`,
        );
        params.push(
          polygon.scenarioMmH,
          polygon.depthCm,
          polygon.source,
          polygon.sourceVersion ?? null,
          polygon.sourceUpdatedAt ? new Date(polygon.sourceUpdatedAt) : null,
          wkt,
        );
      }

      if (values.length) {
        await client.query(
          `INSERT INTO flood_hazard_polygons
             (scenario_mmh, depth_cm, source, source_version, source_updated_at, geom)
           VALUES ${values.join(",")}`,
          params,
        );
      }
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function hasFloodHazardPolygons(): Promise<boolean> {
  if (!dataDb || !postgisAvailable) return false;
  const result = await dataDb.query(
    `SELECT EXISTS (
       SELECT 1 FROM flood_hazard_polygons
     ) AS "hasRows"`,
  );
  return Boolean(result.rows[0]?.hasRows);
}

export async function getFloodHazardsAtPoint(
  lat: number,
  lng: number,
): Promise<Array<{
  scenarioMmPerHour: 78.8 | 100 | 130;
  depthCm: number | null;
  distanceMeters: number;
  source: string;
  sourceType: "official_model";
  retrievedAt: string;
}>> {
  if (!dataDb || !postgisAvailable) return [];

  const result = await dataDb.query(
    `SELECT scenario_mmh AS "scenarioMmPerHour",
            depth_cm AS "depthCm",
            source
     FROM flood_hazard_polygons
     WHERE ST_Covers(
       geom,
       ST_SetSRID(ST_Point($2, $1), 4326)
     )
     ORDER BY scenario_mmh ASC`,
    [lat, lng],
  );

  return result.rows.map((row: any) => ({
    scenarioMmPerHour: Number(row.scenarioMmPerHour) as 78.8 | 100 | 130,
    depthCm: row.depthCm == null ? null : Number(row.depthCm),
    distanceMeters: 0,
    source: row.source,
    sourceType: "official_model" as const,
    retrievedAt: new Date().toISOString(),
  }));
}


export function shouldPreserveExistingSnapshot(
  existing: Pick<CachedSnapshot, "contentHash"> | null,
  incomingContentHash: string,
): boolean {
  return Boolean(existing && existing.contentHash === incomingContentHash);
}

export async function saveSnapshot(
  sourceKey: string,
  scopeKey: string,
  payload: unknown,
  metadata: {
    etag?: string | null;
    lastModified?: string | null;
    sourceUpdatedAt?: string | null;
    sourceVersion?: string | null;
    freshnessMethod?: CachedSnapshot["freshnessMethod"];
    status: string;
  },
): Promise<{ changed: boolean; contentHash: string }> {
  if (!dataDb) throw new Error("DATABASE_URL is required for persistent external data storage");
  const contentHash = hashPayload(payload);
  const existing = await getCachedSnapshot(sourceKey, scopeKey);

  if (shouldPreserveExistingSnapshot(existing, contentHash)) {
    // Content is unchanged: record the check, but do not rewrite the snapshot version.
    await dataDb.query(
      `UPDATE external_data_snapshots
       SET checked_at = NOW(), status = $3,
           etag = COALESCE($4, etag),
           last_modified = COALESCE($5, last_modified),
           source_updated_at = COALESCE($6, source_updated_at),
           source_version = COALESCE($7, source_version),
           freshness_method = COALESCE($8, freshness_method)
       WHERE source_key = $1 AND scope_key = $2`,
      [
        sourceKey, scopeKey, metadata.status,
        metadata.etag ?? null, metadata.lastModified ?? null,
        metadata.sourceUpdatedAt ?? null, metadata.sourceVersion ?? null,
        metadata.freshnessMethod ?? "unknown",
      ],
    );
    return { changed: false, contentHash };
  }

  await dataDb.query(
    `INSERT INTO external_data_snapshots
       (source_key, scope_key, payload, content_hash, etag, last_modified, status, fetched_at,
        checked_at, source_updated_at, source_version, freshness_method)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW(), NOW(), $8, $9, $10)
     ON CONFLICT (source_key, scope_key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   content_hash = EXCLUDED.content_hash,
                   etag = EXCLUDED.etag,
                   last_modified = EXCLUDED.last_modified,
                   status = EXCLUDED.status,
                   fetched_at = NOW(),
                   checked_at = NOW(),
                   source_updated_at = EXCLUDED.source_updated_at,
                   source_version = EXCLUDED.source_version,
                   freshness_method = EXCLUDED.freshness_method`,
    [
      sourceKey,
      scopeKey,
      JSON.stringify(payload),
      contentHash,
      metadata.etag ?? null,
      metadata.lastModified ?? null,
      metadata.status,
      metadata.sourceUpdatedAt ?? null,
      metadata.sourceVersion ?? null,
      metadata.freshnessMethod ?? "unknown",
    ],
  );

  return { changed: true, contentHash };
}

export async function markSnapshotChecked(
  sourceKey: string,
  scopeKey: string,
  metadata: {
    etag?: string | null;
    lastModified?: string | null;
    sourceUpdatedAt?: string | null;
    sourceVersion?: string | null;
    freshnessMethod?: CachedSnapshot["freshnessMethod"];
    status?: string;
  } = {},
): Promise<void> {
  if (!dataDb) return;
  await dataDb.query(
    `UPDATE external_data_snapshots
     SET checked_at = NOW(),
         etag = COALESCE($3, etag),
         last_modified = COALESCE($4, last_modified),
         source_updated_at = COALESCE($5, source_updated_at),
         source_version = COALESCE($6, source_version),
         freshness_method = COALESCE($7, freshness_method),
         status = COALESCE($8, status)
     WHERE source_key = $1 AND scope_key = $2`,
    [
      sourceKey, scopeKey,
      metadata.etag ?? null, metadata.lastModified ?? null,
      metadata.sourceUpdatedAt ?? null, metadata.sourceVersion ?? null,
      metadata.freshnessMethod ?? null, metadata.status ?? null,
    ],
  );
}

export async function getSafetyReference(excludeScopeKey?: string): Promise<{
  accidentCounts: number[];
  floodDepths: number[];
}> {
  if (!dataDb) return { accidentCounts: [], floodDepths: [] };
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", source_key AS "sourceKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('taipei_safety', 'taipei_flood')
       AND status IN ('available', 'empty')`,
  );
  const accidentsByScope = new Map<string, number>();
  const floodByScope = new Map<string, number>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    if (row.sourceKey === "taipei_safety") {
      const count = Array.isArray(row.payload?.accidents) ? row.payload.accidents.length : null;
      if (Number.isFinite(count)) accidentsByScope.set(row.scopeKey, count);
    } else {
      const cells = Array.isArray(row.payload?.cells) ? row.payload.cells : Array.isArray(row.payload?.riskCells) ? row.payload.riskCells : [];
      const depths = cells.map((cell: any) => Number(cell?.depthCm)).filter(Number.isFinite);
      floodByScope.set(row.scopeKey, depths.length ? Math.max(...depths) : 0);
    }
  }
  return {
    accidentCounts: [...accidentsByScope.values()],
    floodDepths: [...floodByScope.values()],
  };
}

export async function getPoiDensityReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );
  const byScope = new Map<string, Map<string, any>>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    if (!byScope.has(row.scopeKey)) byScope.set(row.scopeKey, new Map());
    const scopePois = byScope.get(row.scopeKey)!;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    for (const poi of pois) {
      if (poi.category !== "C2") continue;
      const id = String(poi.id || `${poi.name}|${poi.lat}|${poi.lng}`);
      scopePois.set(id, poi);
    }
  }
  return [...byScope.values()].map((pois) => pois.size);
}

export async function getC5CommunityReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );
  const byScope = new Map<string, Map<string, any>>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    if (!byScope.has(row.scopeKey)) byScope.set(row.scopeKey, new Map());
    const scopePois = byScope.get(row.scopeKey)!;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    for (const poi of pois) {
      const isCommunity = poi.category === "C5"
        || /community|library|活動中心|圖書館|服務中心|公民/.test(String(poi.name || ""));
      if (!isCommunity) continue;
      const id = String(poi.id || `${poi.name}|${poi.lat}|${poi.lng}`);
      scopePois.set(id, poi);
    }
  }

  const targets = await listActiveAssessmentTargets();
  for (const target of targets) {
    if (excludeScopeKey && target.scopeKey === excludeScopeKey) continue;
    const libraries = await getNearbyExternalSpatialPoints("taipei_libraries", target.latitude, target.longitude, 800, 500);
    if (!libraries.length) continue;
    const scopePois = byScope.get(target.scopeKey) || new Map<string, any>();
    for (const library of libraries) {
      scopePois.set(
        `official-library|${library.name}|${library.lat.toFixed(5)}|${library.lng.toFixed(5)}`,
        library,
      );
    }
    byScope.set(target.scopeKey, scopePois);
  }

  return [...byScope.values()].map((pois) => pois.size);
}

export async function getNearestCommunityDistanceReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );
  const nearestByScope = new Map<string, number>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    const scope = parseScope(row.scopeKey);
    if (!scope) continue;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    for (const poi of pois) {
      const isCommunity = poi.category === "C5"
        || /community|library|活動中心|圖書館|服務中心|公民/.test(String(poi.name || ""));
      if (!isCommunity) continue;
      const pLat = Number(poi?.lat);
      const pLng = Number(poi?.lng);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
      const distance = Number.isFinite(Number(poi?.distanceMeters))
        ? Number(poi.distanceMeters)
        : distanceMeters(scope.lat, scope.lng, pLat, pLng);
      const current = nearestByScope.get(row.scopeKey);
      if (current == null || distance < current) nearestByScope.set(row.scopeKey, distance);
    }
  }
  return [...nearestByScope.values()];
}

export async function getGreenDensityReference(
  excludeScopeKey?: string,
): Promise<{ street: number[]; park: number[] }> {
  if (!dataDb) return { street: [], park: [] };
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key = 'taipei_green' AND status = 'available'`,
  );

  const street: number[] = [];
  const park: number[] = [];
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    const streetCount = Array.isArray(row.payload?.streetTrees) ? row.payload.streetTrees.length : null;
    const parkCount = Array.isArray(row.payload?.parkTrees) ? row.payload.parkTrees.length : null;
    const areaKm2 = Math.PI * (0.8 ** 2);
    if (Number.isFinite(streetCount)) street.push(streetCount / areaKm2);
    if (Number.isFinite(parkCount)) park.push(parkCount / areaKm2);
  }
  return { street, park };
}

export interface ExternalSpatialPointRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  properties: Record<string, unknown>;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  sourceVersion: string | null;
}

export async function replaceExternalSpatialPoints(
  sourceKey: string,
  points: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    properties?: Record<string, unknown>;
  }>,
  metadata: { fetchedAt?: string; sourceUpdatedAt?: string | null; sourceVersion?: string | null } = {},
): Promise<void> {
  if (!dataDb) return;

  await dataDb.query("BEGIN");
  try {
    await dataDb.query(
      "DELETE FROM external_spatial_points WHERE source_key = $1",
      [sourceKey],
    );

    const fetchedAt = metadata.fetchedAt || new Date().toISOString();
    const sourceUpdatedAt = metadata.sourceUpdatedAt ?? null;
    const sourceVersion = metadata.sourceVersion ?? null;

    // Keep inserts batched to reduce round trips for citywide inventories.
    const batchSize = 500;
    for (let start = 0; start < points.length; start += batchSize) {
      const batch = points.slice(start, start + batchSize);
      const values: unknown[] = [];
      const correctedRows = batch.map((point, index) => {
        const offset = index * 9;
        values.push(
          sourceKey,
          point.id,
          point.name,
          point.lat,
          point.lng,
          JSON.stringify(point.properties || {}),
          fetchedAt,
          sourceUpdatedAt,
          sourceVersion,
        );
        return `(${offset + 1}, ${offset + 2}, ${offset + 3}, ${offset + 4}, ${offset + 5}, ${offset + 6}::jsonb, ${offset + 7}, ${offset + 8}, ${offset + 9})`;
      });
      await dataDb.query(
        `INSERT INTO external_spatial_points
          (source_key, feature_id, name, latitude, longitude, properties, fetched_at, source_updated_at, source_version)
         VALUES ${correctedRows.join(",")}
         ON CONFLICT (source_key, feature_id) DO UPDATE SET
           name = EXCLUDED.name,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           properties = EXCLUDED.properties,
           fetched_at = EXCLUDED.fetched_at,
           source_updated_at = EXCLUDED.source_updated_at,
           source_version = EXCLUDED.source_version`,
        values,
      );
    }

    await dataDb.query("COMMIT");
  } catch (error) {
    await dataDb.query("ROLLBACK");
    throw error;
  }
}

export async function getNearbyExternalSpatialPoints(
  sourceKey: string,
  lat: number,
  lng: number,
  maxDistanceMeters = 1500,
  limit = 2000,
): Promise<ExternalSpatialPointRecord[]> {
  if (!dataDb) return [];

  const latDelta = maxDistanceMeters / 111_320;
  const lngDelta = maxDistanceMeters / (111_320 * Math.max(0.35, Math.cos(lat * Math.PI / 180)));

  const result = await dataDb.query(
    `SELECT
       feature_id AS "id",
       name,
       latitude AS lat,
       longitude AS lng,
       properties,
       fetched_at AS "fetchedAt",
       source_updated_at AS "sourceUpdatedAt",
       source_version AS "sourceVersion",
       6371000 * 2 * ASIN(SQRT(
         POWER(SIN(RADIANS(latitude - $2) / 2), 2) +
         COS(RADIANS($2)) * COS(RADIANS(latitude)) *
         POWER(SIN(RADIANS(longitude - $3) / 2), 2)
       )) AS "distanceMeters"
     FROM external_spatial_points
     WHERE source_key = $1
       AND latitude BETWEEN $4 AND $5
       AND longitude BETWEEN $6 AND $7
     ORDER BY "distanceMeters" ASC
     LIMIT $8`,
    [
      sourceKey,
      lat,
      lng,
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      limit,
    ],
  );

  return result.rows
    .filter((row) => Number.isFinite(Number(row.distanceMeters)) && Number(row.distanceMeters) <= maxDistanceMeters)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name || row.id),
      lat: Number(row.lat),
      lng: Number(row.lng),
      distanceMeters: Number(row.distanceMeters),
      properties: row.properties || {},
      fetchedAt: new Date(row.fetchedAt).toISOString(),
      sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).toISOString() : null,
      sourceVersion: row.sourceVersion || null,
    }));
}

export async function getSpatialPointCountReference(
  sourceKey: string,
  maxDistanceMeters = 300,
  excludeScopeKey?: string,
): Promise<number[]> {
  if (!dataDb) return [];
  const targets = await listActiveAssessmentTargets();
  const values: number[] = [];

  for (const target of targets) {
    if (excludeScopeKey && target.scopeKey === excludeScopeKey) continue;
    const rows = await getNearbyExternalSpatialPoints(
      sourceKey,
      target.latitude,
      target.longitude,
      maxDistanceMeters,
      5000,
    );
    values.push(rows.length);
  }

  return values;
}

export async function getSpatialPointPropertySumReference(
  sourceKey: string,
  propertyKey: string,
  maxDistanceMeters = 300,
  excludeScopeKey?: string,
): Promise<number[]> {
  if (!dataDb) return [];
  const targets = await listActiveAssessmentTargets();
  const values: number[] = [];

  for (const target of targets) {
    if (excludeScopeKey && target.scopeKey === excludeScopeKey) continue;
    const rows = await getNearbyExternalSpatialPoints(
      sourceKey,
      target.latitude,
      target.longitude,
      maxDistanceMeters,
      5000,
    );
    values.push(rows.reduce((sum, row) => {
      const value = Number(row.properties?.[propertyKey]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0));
  }

  return values;
}

export async function closeDataDb(): Promise<void> {
  if (dataDb) await dataDb.end();
}


function distanceMeters(lat: number, lng: number, pLat: number, pLng: number): number {
  const R = 6371000;
  const dLat = (pLat - lat) * Math.PI / 180;
  const dLng = (pLng - lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat * Math.PI / 180) * Math.cos(pLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseScope(scopeKey: string): { lat: number; lng: number } | null {
  const [lat, lng] = scopeKey.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function getNearestParkDistanceReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", source_key AS "sourceKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );

  const nearestByScope = new Map<string, number>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    const scope = parseScope(row.scopeKey);
    if (!scope) continue;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    for (const poi of pois) {
      if (poi.category !== "C4") continue;
      const pLat = Number(poi?.lat);
      const pLng = Number(poi?.lng);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
      const distance = Number.isFinite(Number(poi?.distanceMeters))
        ? Number(poi.distanceMeters)
        : distanceMeters(scope.lat, scope.lng, pLat, pLng);
      const current = nearestByScope.get(row.scopeKey);
      if (current == null || distance < current) nearestByScope.set(row.scopeKey, distance);
    }
  }

  return [...nearestByScope.values()];
}

export async function getNearestCommunityCulturalDistanceReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );
  const nearestByScope = new Map<string, number>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    const scope = parseScope(row.scopeKey);
    if (!scope) continue;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    for (const poi of pois) {
      const isCommunity = poi.category === "C5"
        || /community|library|活動中心|圖書館|服務中心|公民/.test(String(poi.name || ""));
      if (!isCommunity) continue;
      const pLat = Number(poi?.lat), pLng = Number(poi?.lng);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
      const distance = Number.isFinite(Number(poi?.distanceMeters))
        ? Number(poi.distanceMeters)
        : distanceMeters(scope.lat, scope.lng, pLat, pLng);
      const current = nearestByScope.get(row.scopeKey);
      if (current == null || distance < current) nearestByScope.set(row.scopeKey, distance);
    }
  }

  const targets = await listActiveAssessmentTargets();
  for (const target of targets) {
    if (excludeScopeKey && target.scopeKey === excludeScopeKey) continue;
    const libraries = await getNearbyExternalSpatialPoints("taipei_libraries", target.latitude, target.longitude, 1000, 200);
    const nearestLibrary = libraries.length ? libraries[0].distanceMeters : null;
    if (nearestLibrary != null) {
      const current = nearestByScope.get(target.scopeKey);
      if (current == null || nearestLibrary < current) nearestByScope.set(target.scopeKey, nearestLibrary);
    }
  }

  return [...nearestByScope.values()];
}

export async function getDistanceAndAirQualityReferences(excludeScopeKey?: string): Promise<{
  c2Distances: Partial<Record<"supermarketDist" | "convenienceDist" | "clinicDist" | "schoolDist" | "bankPostDist", number[]>>;
  c3RailDistances: number[];
  c3BusDistances: number[];
  c3YouBikeDistances: number[];
  c4Aqi: number[];
}> {
  if (!dataDb) return { c2Distances: {}, c3RailDistances: [], c3BusDistances: [], c3YouBikeDistances: [], c4Aqi: [] };

  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", source_key AS "sourceKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap', 'tdx_transit', 'open_meteo_air_quality')
       AND status IN ('available', 'empty')`,
  );

  const c2ByScope = new Map<string, Map<string, number>>();
  const c3RailByScope = new Map<string, number>();
  const c3BusByScope = new Map<string, number>();
  const c3YouBikeByScope = new Map<string, number>();
  const c4Aqi: number[] = [];

  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;

    if (row.sourceKey === "open_meteo_air_quality") {
      const aqi = Number(row.payload?.aqi);
      if (Number.isFinite(aqi)) c4Aqi.push(aqi);
      continue;
    }

    if (row.sourceKey === "tdx_transit") {
      const rail = Array.isArray(row.payload?.railStations) ? row.payload.railStations
        .map((x: any) => Number(x?.distanceMeters)).filter(Number.isFinite) : [];
      const bus = Array.isArray(row.payload?.stops) ? row.payload.stops
        .map((x: any) => Number(x?.distanceMeters)).filter(Number.isFinite) : [];
      if (rail.length) c3RailByScope.set(row.scopeKey, Math.min(...rail));
      if (bus.length) c3BusByScope.set(row.scopeKey, Math.min(...bus));
      continue;
    }

    const scope = parseScope(row.scopeKey);
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    if (!scope) continue;
    if (!c2ByScope.has(row.scopeKey)) c2ByScope.set(row.scopeKey, new Map());
    const byType = c2ByScope.get(row.scopeKey)!;
    for (const poi of pois) {
      const pLat = Number(poi?.lat);
      const pLng = Number(poi?.lng);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
      const distance = Number.isFinite(Number(poi?.distanceMeters))
        ? Number(poi.distanceMeters)
        : distanceMeters(scope.lat, scope.lng, pLat, pLng);
      const type = String(poi?.amenityType || "");
      if (!["supermarket", "convenience", "clinic", "school", "bank_post"].includes(type)) continue;
      const existing = byType.get(type);
      if (existing == null || distance < existing) byType.set(type, distance);
    }
  }

  const c2Distances: Partial<Record<"supermarketDist" | "convenienceDist" | "clinicDist" | "schoolDist" | "bankPostDist", number[]>> = {};
  const typeMap = {
    supermarket: "supermarketDist",
    convenience: "convenienceDist",
    clinic: "clinicDist",
    school: "schoolDist",
    bank_post: "bankPostDist",
  } as const;
  for (const [scopeKey, byType] of c2ByScope) {
    for (const [type, distance] of byType) {
      const indicator = typeMap[type as keyof typeof typeMap];
      if (!indicator) continue;
      (c2Distances[indicator] ||= []).push(distance);
    }
  }

  const targets = await listActiveAssessmentTargets();
  for (const target of targets) {
    if (excludeScopeKey && target.scopeKey === excludeScopeKey) continue;

    const medical = await getNearbyExternalSpatialPoints("taipei_medical", target.latitude, target.longitude, 1500, 500);
    if (medical.length) {
      const distance = medical[0].distanceMeters;
      const byType = c2ByScope.get(target.scopeKey) || new Map<string, number>();
      const current = byType.get("clinic");
      if (current == null || distance < current) byType.set("clinic", distance);
      c2ByScope.set(target.scopeKey, byType);
    }

    const busStops = await getNearbyExternalSpatialPoints("taipei_bus_stops", target.latitude, target.longitude, 1500, 1000);
    if (busStops.length) c3BusByScope.set(target.scopeKey, busStops[0].distanceMeters);

    const bikes = await getNearbyExternalSpatialPoints("taipei_youbike", target.latitude, target.longitude, 1500, 200);
    if (bikes.length) c3YouBikeByScope.set(target.scopeKey, bikes[0].distanceMeters);
  }

  return {
    c2Distances,
    c3RailDistances: [...c3RailByScope.values()],
    c3BusDistances: [...c3BusByScope.values()],
    c3YouBikeDistances: [...c3YouBikeByScope.values()],
    c4Aqi,
  };
}
