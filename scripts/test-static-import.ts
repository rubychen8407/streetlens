import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
const { dataDb, hashPayload } = await import('../db');
const { persistStaticImport } = await import('../staticOsm');
const points = Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, name: 'Test fixture only', lat: 25.03, lng: 121.56, properties: { amenityType: i ? 'clinic' : 'park', coordinateMethod: 'node' } }));
const body = { source: 'https://download.geofabrik.de/asia/taiwan.html', sourceUpdatedAt: new Date().toISOString(), points };
let existing: any = null, fail = false;
const queries: string[] = [];
(dataDb as any).connect = async () => ({
  query: async (sql: string) => {
    queries.push(sql);
    if (fail && sql.startsWith('INSERT INTO external_spatial_points')) throw new Error('STORAGE_WRITE_LIMIT');
    return { rows: sql.startsWith('SELECT source_version') && existing ? [existing] : [] };
  }, release() {},
});
assert.equal((await persistStaticImport(body)).changed, true);
assert.equal(queries.at(-1), 'COMMIT');
assert.ok(queries.some(sql => sql.includes('external_data_snapshots') && sql.startsWith('INSERT')), 'inventory and manifest share a transaction');
queries.length = 0; fail = true;
await assert.rejects(() => persistStaticImport(body), /STORAGE_WRITE_LIMIT/);
assert.equal(queries.at(-1), 'ROLLBACK', 'failed point insert cannot destroy previous inventory');
queries.length = 0; fail = false;
existing = { source_version: hashPayload(points.map(p => ({ ...p, properties: { ...p.properties, source: 'OpenStreetMap / Geofabrik' } }))), source_updated_at: body.sourceUpdatedAt, payload: { pointCount: 10 } };
assert.equal((await persistStaticImport(body)).changed, false);
assert.equal(queries.some(sql => sql.startsWith('DELETE')), false, 'unchanged extract is not rewritten');
existing = { ...existing, source_updated_at: new Date(Date.now() + 1000).toISOString() };
await assert.rejects(() => persistStaticImport(body), /older/);
await dataDb?.end();
console.log('Static import transaction tests passed: rollback, unchanged writes, old extract rejection.');
