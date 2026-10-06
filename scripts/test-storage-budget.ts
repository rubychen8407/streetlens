import assert from 'node:assert/strict';
import { ensureStorageBudget, GUARDED_TABLES, WRITE_LIMIT_BYTES } from '../storageBudget';
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
const { dataDb, replaceExternalSpatialPoints, registerAssessmentTarget } = await import('../db');
let statements: string[] = [];
let failInstall = false;
let failWrite = false;
let released = false;
const client = {
  query: async (sql: string, values?: unknown[]) => {
    statements.push(sql);
    if (sql.includes('to_regclass')) return { rows: [{ relation: values?.[0] }] };
    if (failInstall && sql.includes('CREATE TRIGGER')) throw new Error('permission denied');
    if (sql.includes('INSERT INTO external_spatial_points')) {
      assert.ok(sql.includes('($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)'));
      if (failWrite) throw new Error('STORAGE_WRITE_LIMIT');
    }
    return { rows: [] };
  },
  release: () => { released = true; },
};
(dataDb as any).connect = async () => client;
(dataDb as any).query = async () => { throw new Error('Must use the transaction connection'); };
try {
  await ensureStorageBudget(dataDb);
  assert.equal(statements.filter(s => s.startsWith('CREATE TRIGGER')).length, GUARDED_TABLES.length * 2);
  assert.ok(statements.some(s => s.includes(`>= ${WRITE_LIMIT_BYTES}`)));
  assert.ok(statements.some(s => s.includes('pg_advisory_xact_lock')));
  assert.equal(statements.some(s => /DELETE FROM|TRUNCATE/.test(s)), false);
  failInstall = true; statements = [];
  await assert.rejects(ensureStorageBudget(dataDb), /permission denied/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  failWrite = true; statements = []; released = false;
  await assert.rejects(replaceExternalSpatialPoints('trees', [{ id: 'one', name: 'tree', lat: 25, lng: 121 }]), /STORAGE_WRITE_LIMIT/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(released, true);
  (dataDb as any).query = async () => { throw new Error('STORAGE_WRITE_LIMIT'); };
  assert.equal(typeof await registerAssessmentTarget(25, 121), 'string');
  (dataDb as any).query = async () => { throw new Error('connection lost'); };
  await assert.rejects(registerAssessmentTarget(25, 121), /connection lost/);
  console.log('Storage budget: all tables guarded; installation fails closed; replacement rolls back on quota failure.');
} finally { await dataDb?.end(); }
