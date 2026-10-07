import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSpatialInventory } from '../spatialInventory';
import { visibleFactors } from '../src/utils/formatNumber';

process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
const database = await import('../db');
const { sourceRevision, BASELINE_SCORING_VERSION } = await import('../streetBaselineStore');
assert.ok(database.dataDb);
const pg = new PGlite();
// Real PostgreSQL binding, JSONB, uniqueness and transactions. Text stubs
// deliberately do not test PostGIS geometry semantics.
await pg.exec(`
  CREATE FUNCTION ST_GeomFromText(text) RETURNS text LANGUAGE SQL AS 'SELECT $1';
  CREATE FUNCTION ST_GeomFromGeoJSON(text) RETURNS text LANGUAGE SQL AS 'SELECT $1';
  CREATE FUNCTION ST_SetSRID(text, integer) RETURNS text LANGUAGE SQL AS 'SELECT $1';
  CREATE TABLE external_spatial_points (
    source_key text, feature_id text, name text, latitude double precision, longitude double precision,
    properties jsonb, fetched_at timestamptz, source_updated_at timestamptz, source_version text,
    PRIMARY KEY(source_key, feature_id));
  CREATE TABLE external_spatial_lines (
    source_key text, feature_id text, name text, properties jsonb, fetched_at timestamptz,
    source_updated_at timestamptz, source_version text, geom text,
    PRIMARY KEY(source_key, feature_id));
  CREATE TABLE external_spatial_areas (LIKE external_spatial_lines INCLUDING ALL);
  CREATE TABLE external_data_snapshots (
    source_key text, scope_key text, content_hash text, status text,
    source_version text, source_updated_at timestamptz);
  INSERT INTO external_data_snapshots VALUES
    ('taipei_aed', '__citywide__', 'old-aed', 'available', NULL, NULL),
    ('taipei_public_toilets', '__citywide__', 'old-toilets', 'available', NULL, NULL),
    ('taipei_street_lights', '__citywide__', 'lights', 'available', NULL, NULL);
`);
(database.dataDb as any).query = async () => ({ rows: [] });
await database.ensureDataCacheSchema();
let failTable = '';
let insertCount = 0;
let releases = 0;
(database.dataDb as any).connect = async () => ({
  query: async (sql: string, values?: unknown[]) => {
    if (failTable && sql.includes('INSERT INTO ' + failTable) && ++insertCount === 2) throw new Error('second batch failure');
    return pg.query(sql, values);
  },
  release: () => { releases++; },
});
try {
  const revisionDb = { query: (sql: string) => pg.query(sql) } as any;
  const revision = await sourceRevision(revisionDb);
  assert.ok(revision.startsWith(BASELINE_SCORING_VERSION + ':'));
  assert.notEqual(BASELINE_SCORING_VERSION, 'street-anchor-v1', 'changed scoring invalidates cached baselines');
  await pg.exec("UPDATE external_data_snapshots SET content_hash = 'retired-changed' WHERE source_key IN ('taipei_aed','taipei_public_toilets')");
  assert.equal(await sourceRevision(revisionDb), revision, 'retired feeds cannot invalidate baselines');
  await pg.exec("UPDATE external_data_snapshots SET content_hash = 'lights-changed' WHERE source_key = 'taipei_street_lights'");
  assert.notEqual(await sourceRevision(revisionDb), revision);
  const point = { id: 'shared', name: 'lamp', lat: 25, lng: 121, properties: { count: 1 } };
  const other = { ...point, lat: 25.1, properties: { count: 2 } };
  const normalized = normalizeSpatialInventory([point, point, other]);
  assert.equal(normalized.length, 2, 'exact repeats deduplicate; distinct observations remain');
  assert.equal(new Set(normalized.map(p => p.id)).size, 2);
  assert.deepEqual(normalizeSpatialInventory([other, point]).map(p => p.id).sort(), normalized.map(p => p.id).sort());
  assert.deepEqual(normalizeSpatialInventory(normalized), normalized);
  assert.equal(point.id, 'shared', 'input is not mutated');
  const points = [point, point, ...Array.from({ length: 501 }, (_, i) => ({ ...point, id: 'lamp-' + i })), other];
  const lines = Array.from({ length: 201 }, (_, i) => ({ id: 'line-' + i, name: 'lane', coordinates: [[121, 25], [121.1, 25.1]] as Array<[number, number]>, properties: { i } }));
  const areas = Array.from({ length: 101 }, (_, i) => ({ id: 'area-' + i, name: 'sidewalk', geometry: { type: 'Polygon' as const, coordinates: [[[121, 25], [121.1, 25], [121.1, 25.1], [121, 25]]] }, properties: { i } }));
  const scenarios = [
    { table: 'external_spatial_points', run: () => database.replaceExternalSpatialPoints('test', points), count: 503 },
    { table: 'external_spatial_lines', run: () => database.replaceExternalSpatialLines('test', [...lines, lines[0], { ...lines[0], name: 'distinct' }]), count: 202 },
    { table: 'external_spatial_areas', run: () => database.replaceExternalSpatialAreas('test', [...areas, areas[0], { ...areas[0], name: 'distinct' }]), count: 102 },
  ];
  for (const scenario of scenarios) {
    await scenario.run();
    const before = (await pg.query(`SELECT * FROM ${scenario.table} ORDER BY feature_id`)).rows;
    assert.equal(before.length, scenario.count, 'all batches bind correctly');
    assert.equal(typeof (before[0] as any).properties, 'object');
    failTable = scenario.table;
    insertCount = 0;
    await assert.rejects(scenario.run(), /second batch failure/);
    failTable = '';
    assert.deepEqual((await pg.query(`SELECT * FROM ${scenario.table} ORDER BY feature_id`)).rows, before, 'rollback preserves the previous inventory');
  }
  assert.equal(releases, 6);
  const legacy = [{ indicator: 'aedCount500m' }, { indicator: 'publicToiletCount800m' }, { indicator: 'streetLightCount300m' }];
  assert.deepEqual(visibleFactors(legacy), [legacy[2]]);
  assert.equal(legacy.length, 3, 'history is not rewritten');
  console.log('Spatial IDs, multi-batch JSONB binding, rollback and legacy factor filtering passed.');
} finally {
  await database.dataDb.end();
  await pg.close();
}
