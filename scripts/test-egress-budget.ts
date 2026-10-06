import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { ReadCache, referenceReadCache, assessmentReadCache, invalidateSourceReads } from '../readCache';
import { ReadRetry } from '../src/utils/readRetry';
import { readReferenceSnapshots } from '../referenceSnapshots';
import { QueryTransferMetrics } from '../queryTransferMetrics';

let now = 0, loads = 0;
const cache = new ReadCache(100, 2, () => now);
const load = async () => { loads++; return loads; };
assert.deepEqual(await Promise.all([cache.get('a', load), cache.get('a', load)]), [1, 1]);
now = 101;
assert.equal(await cache.get('a', load), 2, 'TTL refreshes values');
await cache.get('b', load); await cache.get('c', load);
assert.equal(await cache.get('a', load), 5, 'bounded cache evicts oldest entry');
let release!: (n: number) => void;
const stale = cache.get('race', () => new Promise<number>(resolve => { release = resolve; }));
await Promise.resolve(); cache.clear();
assert.equal(await cache.get('race', async () => 9), 9);
release(8); await stale;
assert.equal(await cache.get('race', async () => 10), 9, 'invalidated in-flight result cannot replace new value');
await assert.rejects(cache.get('error', async () => { throw Error('offline'); }), /offline/);
assert.equal(await cache.get('error', async () => 11), 11, 'errors are not cached');
await cache.get('pending', async () => 202, () => false);
assert.equal(await cache.get('pending', async () => 200), 200, 'non-cacheable result is retried');
const retry = new ReadRetry(() => now);
for (const delay of [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
  retry.defer('location'); assert.equal(retry.due('location'), false);
  now += delay - 1; assert.equal(retry.due('location'), false);
  now++; assert.equal(retry.due('location'), true);
}
retry.reset('location'); assert.equal(retry.due('location'), true);

const events: any[] = [];
const metrics = new QueryTransferMetrics(event => events.push(event), () => now);
const sensitive = [{ workspaceId: 'DO-NOT-LOG', latitude: 25, photo: 'private-photo' }];
assert.equal((await metrics.query('snapshot.exact', async () => ({ rows: sensitive }))).rows, sensitive);
await assert.rejects(metrics.query('snapshot.exact', async () => { throw Error('private SQL error'); }));
metrics.flush();
assert.equal(events[0].operations['snapshot.exact'].queries, 2);
assert.equal(events[0].operations['snapshot.exact'].errors, 1);
assert.equal(events[0].operations['snapshot.exact'].estimatedResultBytes, Buffer.byteLength(JSON.stringify(sensitive)));
assert.equal(/DO-NOT-LOG|private-photo|latitude|private SQL/.test(JSON.stringify(events)), false, 'metrics log counters only');
const badEmitter = new QueryTransferMetrics(() => { throw Error('logger unavailable'); });
await badEmitter.query('test', async () => ({ rows: [{ n: 1n }] }));
badEmitter.flush(); // logging/measurement failures must not break a read
let releaseQuery!: (value: { rows: any[] }) => void;
const delayed = metrics.query('delayed', () => new Promise<{ rows: any[] }>(resolve => { releaseQuery = resolve; }));
metrics.flush();
releaseQuery({ rows: [{ value: 1 }] }); await delayed;
metrics.flush();
assert.equal(events.at(-1).operations.delayed.rows, 1, 'flush during an in-flight query must not lose byte/row counters');

// Execute the actual queries against PostgreSQL (PGlite), with isolated fixtures.
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
const db = await import('../db');
const sqlDb = new PGlite();
const statements: string[] = [];
let transferred = 0;
const query = async (sql: string, values: any[] = []) => {
  statements.push(sql);
  const result = await sqlDb.query(sql, values);
  transferred += Buffer.byteLength(JSON.stringify(result.rows));
  return { ...result, rowCount: result.affectedRows };
};
(db.dataDb as any).query = query;
await sqlDb.exec(`
  CREATE TABLE external_data_snapshots (
    source_key text, scope_key text, payload jsonb NOT NULL, content_hash text,
    etag text, last_modified text, status text, fetched_at timestamptz DEFAULT NOW(),
    checked_at timestamptz DEFAULT NOW(), source_updated_at timestamptz,
    source_version text, freshness_method text, PRIMARY KEY(source_key, scope_key));
  CREATE TABLE assessment_targets (scope_key text PRIMARY KEY, latitude double precision,
    longitude double precision, active boolean DEFAULT TRUE, last_requested_at timestamptz DEFAULT NOW());
  CREATE TABLE external_spatial_points (source_key text, feature_id text, name text,
    latitude double precision, longitude double precision, properties jsonb,
    fetched_at timestamptz DEFAULT NOW(), source_updated_at timestamptz, source_version text);`);
const a = '25.000,121.000', b = '25.001,121.001', far = '24.000,120.000';
await sqlDb.query(`INSERT INTO assessment_targets(scope_key, latitude, longitude) VALUES ($1,25,121),($2,25.001,121.001),($3,24,120)`, [a, b, far]);
const add = (source: string, scope: string, payload: any) => sqlDb.query(
  `INSERT INTO external_data_snapshots(source_key,scope_key,payload,status) VALUES ($1,$2,$3,'available')`, [source, scope, JSON.stringify(payload)]);
const poi = { id: 'clinic', name: 'clinic', lat: 25, lng: 121, category: 'C2', amenityType: 'clinic', distanceMeters: 12, raw: 'x'.repeat(50_000) };
const community = { id: 'library', name: 'library', lat: 25, lng: 121, category: 'C5', distanceMeters: 20 };
const park = { id: 'park', name: 'park', lat: 25, lng: 121, category: 'C4', distanceMeters: 30 };
await add('google_places', a, { pois: [poi, community, park] });
await add('openstreetmap', a, { pois: [poi] });
await add('google_places', b, { pois: [{ ...poi, id: 'shop', distanceMeters: null }, { ...community, distanceMeters: undefined }] });
await add('open_meteo_air_quality', a, { aqi: 42, unused: 'x'.repeat(20_000) });
await add('tdx_transit', a, { stops: [{ distanceMeters: 11 }, {}], railStations: [{ distanceMeters: 99 }] });
await add('taipei_green', a, { streetTrees: Array.from({ length: 1000 }, (_, id) => ({ id, raw: 'x'.repeat(100) })), parkTrees: [1, 2] });
await add('taipei_green', b, { streetTrees: [], parkTrees: null });
await add('taipei_safety', a, { accidents: [1, 2, 3] });
await add('taipei_flood', a, { riskCells: [{ depthCm: null }, {}, { depthCm: 'bad' }, { depthCm: '35' }, { depthCm: 12 }] });
await add('taipei_flood', b, { cells: [{ depthCm: -3 }], riskCells: [{ depthCm: 99 }] });
for (const source of ['taipei_medical', 'taipei_markets', 'taipei_libraries', 'taipei_parks', 'taipei_aed', 'taipei_fire_hydrants', 'taipei_cooling_points', 'taipei_bus_stops', 'taipei_mrt_stations', 'taipei_youbike', 'taipei_street_lights']) {
  await sqlDb.query(`INSERT INTO external_spatial_points(source_key,feature_id,name,latitude,longitude,properties)
    VALUES ($1,'one','official',25,121,'{"quantity":2,"raw":"unused"}'),($1,'two','official2',25.0001,121,'{"quantity":"3"}')`, [source]);
}
invalidateSourceReads(); statements.length = 0; transferred = 0;
const green = await db.getGreenDensityReference();
assert.deepEqual(green, { street: [1000 / (Math.PI * 0.8 ** 2), 0], park: [2 / (Math.PI * 0.8 ** 2)] });
assert.ok(transferred < 200, 'tree references transfer counts, not 1000 tree objects');
assert.deepEqual(await db.getSafetyReference(), { accidentCounts: [3], floodDepths: [35, -3] });
const snapshots = await readReferenceSnapshots(sql => query(sql));
assert.equal(snapshots.find(r => r.sourceKey === 'google_places' && r.scopeKey === a).payload.pois[0].raw, undefined);
const missingDistance = snapshots.find(r => r.scopeKey === b).payload.pois[1];
assert.equal(Object.hasOwn(missingDistance, 'distanceMeters'), false, 'absent and null values remain distinct');
assert.equal(snapshots.find(r => r.scopeKey === b).payload.pois[0].distanceMeters, null);
const compactReads = () => statements.filter(sql => sql.includes("END AS payload")).length;
await Promise.all([db.getPoiDensityReference(), db.getC5CommunityReference(), db.getNearestParkDistanceReference(a), db.getNearestCommunityDistanceReference(a), db.getDistanceAndAirQualityReferences()]);
assert.equal(compactReads(), 1, 'all POI/distance reference consumers share one read');
assert.deepEqual(await db.getPoiDensityReference(), [5, 5, 0], 'deduplication and official POIs remain included');
const distances = await db.getDistanceAndAirQualityReferences();
assert.deepEqual(distances.c4Aqi, [42]);
assert.deepEqual(distances.c1AedCounts, [2, 2, 0]);
assert.deepEqual(await db.getSpatialPointCountReference('taipei_aed', 500, b), [2, 0]);
assert.deepEqual(await db.getSpatialPointPropertySumReference('taipei_street_lights', 'quantity', 300), [5, 5, 0]);
const reads = statements.length;
await Promise.all([db.getPoiDensityReference(), db.getDistanceAndAirQualityReferences(), db.getGreenDensityReference()]);
assert.equal(statements.length, reads, 'warm reference reads perform no database query');

// Local evaluation parity: aggregate inside PostgreSQL with the same radii,
// candidate snapshots and duplicate-count behavior as the existing JS pipeline.
const distance = (p: any) => {
  const dLat = (Number(p.lat) - 25) * Math.PI / 180;
  const dLng = (Number(p.lng) - 121) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(25 * Math.PI / 180)
    * Math.cos(Number(p.lat) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const filter = (points: any[], radius: number) => points.filter(p => Number.isFinite(Number(p.lat))
  && Number.isFinite(Number(p.lng)) && distance(p) <= radius);
const treePoints = [
  { lat: 25, lng: 121, raw: 'x'.repeat(100_000) },
  { lat: '25.001', lng: '121' },
  { lat: 25 + 799.9 / 6371000 * 180 / Math.PI, lng: 121 },
  { lat: 25 + 800.1 / 6371000 * 180 / Math.PI, lng: 121 },
  { lat: 'bad', lng: 121 }, {}, { lat: null, lng: null },
];
const accidentPoints = [
  { id: 'fatal', lat: 25, lng: 121, type: 'A1 死亡', raw: 'x'.repeat(100_000) },
  { id: 'injury', lat: 25.001, lng: 121, type: '2類受傷' },
  { id: 'both', lat: '25', lng: '121', type: 'A1 A2' },
  { lat: 26, lng: 121, type: 'A1' }, { lat: 'bad', lng: 121, type: 'A2' },
];
await sqlDb.query(`UPDATE external_data_snapshots SET payload=$1 WHERE source_key='taipei_green' AND scope_key=$2`,
  [JSON.stringify({ streetTrees: treePoints, parkTrees: treePoints, source: 'real fixture provenance', status: 'available' }), a]);
await sqlDb.query(`UPDATE external_data_snapshots SET payload=$1 WHERE source_key='taipei_safety' AND scope_key=$2`,
  [JSON.stringify({ accidents: accidentPoints, source: 'fixture', status: 'available' }), a]);
transferred = 0;
const localRead = { lat: 25, lng: 121 };
const localGreen = await db.getCachedSnapshot('taipei_green', a, localRead);
assert.equal(localGreen?.payload.streetTreeCount800m, filter(treePoints, 800).length);
assert.equal(Object.hasOwn(localGreen!.payload, 'streetTrees'), false);
const localSafety = await db.getCachedSnapshot('taipei_safety', a, localRead);
const expectedAccidents = filter(accidentPoints, 500);
assert.equal(localSafety?.payload.accidentCount500m, expectedAccidents.length);
assert.equal(localSafety?.payload.fatalAccidentCount500m, expectedAccidents.filter(p => /1類|A1|死亡/.test(String(p.type || ''))).length);
assert.equal(localSafety?.payload.injuryAccidentCount500m, expectedAccidents.filter(p => /2類|A2|受傷/.test(String(p.type || ''))).length);
assert.equal(Object.hasOwn(localSafety!.payload, 'accidents'), false);
assert.ok(transferred < 2500, 'local scoring reads no tree/accident raw details');
const detailed = await db.getCachedSnapshot('taipei_safety', a, { ...localRead, includeAccidents: true });
assert.deepEqual(detailed?.payload.accidents, expectedAccidents, 'explicit detail reads preserve original records');
const nearbyGreen = await db.getNearbyCachedSnapshots('taipei_green', 25, 121, 1000, 3, localRead);
assert.equal(nearbyGreen.find(row => row.scopeKey === a)?.payload.streetTreeCount800m, filter(treePoints, 800).length);
assert.equal(nearbyGreen.every(row => !Object.hasOwn(row.payload, 'streetTrees')), true);
await sqlDb.query(`INSERT INTO external_spatial_points(source_key,feature_id,name,latitude,longitude,properties)
  VALUES ('taipei_street_lights','missing','missing',25,121,'{}'),
    ('taipei_street_lights','null','null',25,121,'{"quantity":null}'),
    ('taipei_street_lights','invalid','invalid',25,121,'{"quantity":"bad"}'),
    ('taipei_street_lights','boolean','boolean',25,121,'{"quantity":true}')`);
const fullLights = await db.getNearbyExternalSpatialPoints('taipei_street_lights', 25, 121, 300, 5000);
const expectedLightSum = fullLights.reduce((sum, point) => {
  const quantity = Number(point.properties.quantity); return sum + (Number.isFinite(quantity) ? quantity : 1);
}, 0);
const localFacilities = await db.getLocalFacilityMetrics(25, 121);
assert.equal(localFacilities.taipei_street_lights.quantitySum, expectedLightSum);
assert.equal(localFacilities.taipei_street_lights.count, fullLights.length);
for (const [source, radius, limit] of [['taipei_aed', 500, 500], ['taipei_fire_hydrants', 500, 1000], ['taipei_cooling_points', 1200, 300]] as const) {
  assert.equal(localFacilities[source].count, (await db.getNearbyExternalSpatialPoints(source, 25, 121, radius, limit)).length);
}
await sqlDb.query(`UPDATE external_spatial_points SET properties='{"active":false,"availableRentBikes":0,"availableReturnBikes":null,"raw":"unused"}'
  WHERE source_key='taipei_youbike'`);
const projectedBikes = await db.getAssessmentSpatialPoints('taipei_youbike', 25, 121, 1500, 500);
assert.deepEqual(projectedBikes[0].properties, { active: false, availableRentBikes: 0, availableReturnBikes: null });
assert.deepEqual((await db.getAssessmentSpatialPoints('taipei_medical', 25, 121, 1500, 500))[0].properties, {});

await db.getNearbyCachedSnapshots('taipei_green', 25, 121, 10, 6);
assert.equal(statements.at(-1)?.includes(')) <= $5'), true, 'radius filtering happens in SQL before transfer');
assert.deepEqual((await db.getNearbyCachedSnapshots('taipei_green', 25, 121, 10, 6)).map(row => row.scopeKey), [a]);
await assessmentReadCache.get('test', async () => 1);
await db.saveSnapshot('taipei_green', a, { streetTrees: [], parkTrees: [] }, { status: 'available' });
const metadataSql = [...statements].reverse().find(sql => sql.includes('content_hash AS "contentHash"') && !sql.includes('s.payload'))!;
assert.equal(/\bpayload\b/.test(metadataSql), false, 'hash/cadence reads omit payload');
assert.deepEqual(await db.getGreenDensityReference(), { street: [0, 0], park: [0] }, 'refresh invalidates reference values immediately');
assert.equal(await assessmentReadCache.get('test', async () => 2), 2, 'refresh invalidates assessment responses');
const schedule = readFileSync(new URL('../.github/workflows/data-refresh.yml', import.meta.url), 'utf8');
assert.equal(schedule.includes('schedule:'), false, 'only one automatic refresh workflow remains');
assert.ok(readFileSync(new URL('../render.yaml', import.meta.url), 'utf8').includes('healthCheckPath: /api/live'));
await sqlDb.close(); await db.dataDb?.end(); referenceReadCache.clear();
console.log('Egress budget: PostgreSQL aggregates/projections, shared reads, TTL/single-flight/invalidation, retry backoff and schedule checks passed.');
