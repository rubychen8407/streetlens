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

export async function ensureDataCacheSchema(): Promise<void> {
  if (!dataDb) return;
  await dataDb.query(`
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
  return [...nearestByScope.values()];
}

export async function getDistanceAndAirQualityReferences(excludeScopeKey?: string): Promise<{
  c2Distances: Partial<Record<"supermarketDist" | "convenienceDist" | "clinicDist" | "schoolDist" | "bankPostDist", number[]>>;
  c3RailDistances: number[];
  c3BusDistances: number[];
  c4Aqi: number[];
}> {
  if (!dataDb) return { c2Distances: {}, c3RailDistances: [], c3BusDistances: [], c4Aqi: [] };

  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", source_key AS "sourceKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap', 'tdx_transit', 'open_meteo_air_quality')
       AND status IN ('available', 'empty')`,
  );

  const c2ByScope = new Map<string, Map<string, number>>();
  const c3RailByScope = new Map<string, number>();
  const c3BusByScope = new Map<string, number>();
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

  return {
    c2Distances,
    c3RailDistances: [...c3RailByScope.values()],
    c3BusDistances: [...c3BusByScope.values()],
    c4Aqi,
  };
}
