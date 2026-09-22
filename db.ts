import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || "";
export const dataDb = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  : null;

export interface CachedSnapshot {
  sourceKey: string;
  scopeKey: string;
  payload: any;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  fetchedAt: string;
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
      UNIQUE (source_key, scope_key)
    );

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
            fetched_at AS "fetchedAt", status
     FROM external_data_snapshots
     WHERE source_key = $1 AND scope_key = $2`,
    [sourceKey, scopeKey],
  );
  return result.rows[0] || null;
}

export async function saveSnapshot(
  sourceKey: string,
  scopeKey: string,
  payload: unknown,
  metadata: { etag?: string | null; lastModified?: string | null; status: string },
): Promise<{ changed: boolean; contentHash: string }> {
  if (!dataDb) throw new Error("DATABASE_URL is required for persistent external data storage");
  const contentHash = hashPayload(payload);
  const existing = await getCachedSnapshot(sourceKey, scopeKey);

  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.etag === (metadata.etag ?? existing.etag) &&
    existing.lastModified === (metadata.lastModified ?? existing.lastModified)
  ) {
    // Source content is unchanged. Keep the stored payload and version.
    return { changed: false, contentHash };
  }

  await dataDb.query(
    `INSERT INTO external_data_snapshots
       (source_key, scope_key, payload, content_hash, etag, last_modified, status, fetched_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW())
     ON CONFLICT (source_key, scope_key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   content_hash = EXCLUDED.content_hash,
                   etag = EXCLUDED.etag,
                   last_modified = EXCLUDED.last_modified,
                   status = EXCLUDED.status,
                   fetched_at = NOW()`,
    [
      sourceKey,
      scopeKey,
      JSON.stringify(payload),
      contentHash,
      metadata.etag ?? null,
      metadata.lastModified ?? null,
      metadata.status,
    ],
  );

  return { changed: true, contentHash };
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

export async function getC5CommunityReference(excludeScopeKey?: string): Promise<number[]> {
  if (!dataDb) return [];
  const result = await dataDb.query(
    `SELECT scope_key AS "scopeKey", payload
     FROM external_data_snapshots
     WHERE source_key IN ('google_places', 'openstreetmap')
       AND status IN ('available', 'empty')`,
  );
  const byScope = new Map<string, number>();
  for (const row of result.rows) {
    if (excludeScopeKey && row.scopeKey === excludeScopeKey) continue;
    const pois = Array.isArray(row.payload?.pois) ? row.payload.pois : [];
    const count = pois.filter((poi: any) =>
      poi.category === "C5"
      || /community|library|活動中心|圖書館|服務中心|公民/.test(String(poi.name || "")),
    ).length;
    byScope.set(row.scopeKey, (byScope.get(row.scopeKey) || 0) + count);
  }
  return [...byScope.values()];
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
