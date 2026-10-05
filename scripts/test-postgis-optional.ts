import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgres://streetlens-test:streetlens-test@localhost/streetlens';

const database = await import('../db');
assert.ok(database.dataDb, 'test database pool is configured');

const statements: string[] = [];
(database.dataDb as any).query = async (sql: string) => {
  statements.push(sql);
  if (sql.includes('CREATE EXTENSION IF NOT EXISTS postgis')) {
    throw new Error('permission denied to create extension');
  }
  return { rows: [] };
};

await database.ensureDataCacheSchema();

const coreSchema = statements.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS external_data_snapshots'));
assert.ok(coreSchema, 'core CLS snapshot tables initialize without PostGIS');
assert.match(coreSchema, /CREATE TABLE IF NOT EXISTS assessment_targets/);
assert.doesNotMatch(coreSchema, /geometry\s*\(/i, 'core schema does not depend on PostGIS geometry types');
assert.equal(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS external_spatial_areas')), false,
  'PostGIS spatial tables are skipped when the extension is unavailable');

await database.dataDb.end();
console.log('Optional PostGIS failure leaves the core CLS cache schema available.');
