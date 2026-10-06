import type { Pool } from 'pg';
import { spatialScopeKey } from './db';
import { distanceMeters, streetIdentity, STREET_ANCHOR_RADIUS_METERS, rebaseSavedStreet } from './src/utils/streetBaseline';
import type { SavedLocation, StreetAssessmentResponse } from './src/types';
import type { AssessmentReadResult } from './savedScoreBackfill';

export const BASELINE_SCORING_VERSION = 'street-anchor-v1';
type Location = { lat: number; lng: number; city: string; district: string; streetName: string };
type Anchor = { id: string; lat: number; lng: number; street_identity: string };

export async function resolveStreetAnchor(db: Pick<Pool, 'connect'>, location: Location): Promise<Anchor> {
  let identity = streetIdentity(location.city, location.district, location.streetName);
  if (!location.streetName.trim() || /未知|selected street|unknown/i.test(location.streetName)) identity += ':' + spatialScopeKey(location.lat, location.lng);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize first-anchor creation across server instances. No name-only
    // union, coordinate rounding or chain expansion of the segment radius.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity]);
    const candidates = await client.query(
      `SELECT id::text, latitude AS lat, longitude AS lng, street_identity FROM street_baselines
       WHERE street_identity = $1 AND latitude BETWEEN $2 - 0.003 AND $2 + 0.003
       ORDER BY id`, [identity, location.lat]);
    const anchor = candidates.rows.filter(row => distanceMeters(row, location) <= STREET_ANCHOR_RADIUS_METERS)
      .sort((a, b) => distanceMeters(a, location) - distanceMeters(b, location))[0];
    if (anchor) { await client.query('COMMIT'); return anchor; }
    const inserted = await client.query(
      `INSERT INTO street_baselines (street_identity, latitude, longitude) VALUES ($1,$2,$3)
       RETURNING id::text, latitude AS lat, longitude AS lng, street_identity`, [identity, location.lat, location.lng]);
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function sourceRevision(db: Pick<Pool, 'query'>): Promise<string> {
  // Content/version only: requests, target registration and checked_at do NOT
  // invalidate a baseline. Source-expiry transitions do invalidate availability.
  // Return one digest rather than transferring source payloads/reference arrays.
  const rows = await db.query(`SELECT md5(COALESCE(string_agg(
    source_key || ':' || scope_key || ':' || content_hash || ':' || status || ':' ||
    COALESCE(source_version, '') || ':' || COALESCE(source_updated_at::text, '') || ':' ||
    CASE WHEN source_key IN ('osm_static_taipei','taipei_official_aqi','open_meteo_air_quality') THEN
      (source_updated_at IS NOT NULL AND source_updated_at >= NOW() -
       CASE source_key WHEN 'osm_static_taipei' THEN INTERVAL '30 days'
       WHEN 'taipei_official_aqi' THEN INTERVAL '24 hours' ELSE INTERVAL '48 hours' END)::text
    ELSE '' END, '|' ORDER BY source_key, scope_key), '')) AS revision
    FROM external_data_snapshots`);
  return `${BASELINE_SCORING_VERSION}:${rows.rows[0].revision}`;
}

export async function loadUnifiedBaseline(db: Pick<Pool, 'query' | 'connect'>, location: Location,
  compute: (location: Location) => Promise<AssessmentReadResult>): Promise<AssessmentReadResult> {
  const anchor = await resolveStreetAnchor(db, location);
  const revision = await sourceRevision(db);
  const cached = await db.query('SELECT payload FROM street_baselines WHERE id = $1 AND revision = $2', [anchor.id, revision]);
  const decorate = (snapshot: StreetAssessmentResponse) => ({ status: 200, body: {
    ...snapshot, location: { ...location },
  } });
  if (cached.rows[0]?.payload) return decorate(cached.rows[0].payload);
  const result = await compute({ ...location, lat: anchor.lat, lng: anchor.lng });
  if (result.status !== 200 || result.body?.scores?.overall == null) return result;
  if (await sourceRevision(db) !== revision) return { status: 202, body: {
    dataStatus: 'pending_refresh', message: '外部資料正在更新，稍後重新讀取共用基準。',
  } };
  const body = { ...result.body, baseline: { streetIdentity: anchor.street_identity,
    segmentId: anchor.id, anchor: { lat: anchor.lat, lng: anchor.lng },
    version: `${revision}:${anchor.id}`, scoringVersion: BASELINE_SCORING_VERSION } };
  // One latest baseline per segment, not an ever-growing history. Concurrent
  // computations of the same revision return the first committed result.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['baseline:' + anchor.id]);
    // A different source revision must not be overwritten by a late response.
    if (await sourceRevision(client) !== revision) {
      await client.query('COMMIT');
      return { status: 202, body: { dataStatus: 'pending_refresh' } };
    }
    const existing = await client.query('SELECT payload FROM street_baselines WHERE id = $1 AND revision = $2', [anchor.id, revision]);
    if (existing.rows[0]?.payload) { await client.query('COMMIT'); return decorate(existing.rows[0].payload); }
    await client.query('UPDATE street_baselines SET revision = $2, payload = $3::jsonb, computed_at = NOW() WHERE id = $1',
      [anchor.id, revision, JSON.stringify(body)]);
    await client.query('COMMIT');
    return decorate(body);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function overlaySavedBaselines<T extends SavedLocation>(db: Pick<Pool, 'query'>, records: T[]): Promise<T[]> {
  if (!records.length) return records;
  const identities = [...new Set(records.map(record => streetIdentity(record.city, record.district, record.streetName)))];
  // One bounded query for the whole library; no per-visit assessment/source calls.
  const rows = await db.query('SELECT payload FROM street_baselines WHERE street_identity = ANY($1::text[]) AND payload IS NOT NULL', [identities]);
  return records.map(record => {
    const candidates = rows.rows.map(row => row.payload as StreetAssessmentResponse)
      .filter(snapshot => snapshot.baseline?.streetIdentity === streetIdentity(record.city, record.district, record.streetName)
        && distanceMeters(record.coords, snapshot.baseline.anchor) <= STREET_ANCHOR_RADIUS_METERS)
      .sort((a, b) => distanceMeters(record.coords, a.baseline!.anchor) - distanceMeters(record.coords, b.baseline!.anchor));
    return (candidates[0] ? rebaseSavedStreet(record, candidates[0]) : record) as T;
  });
}
