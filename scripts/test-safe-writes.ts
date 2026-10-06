import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
const { dataDb } = await import('../db');
const { saveAssessmentSession } = await import('../assessmentDb');
const original = { id: 'visit', clsScore: 81, fieldNotes: 'old note', evidence: [{ id: 'old-photo' }] };
let mode: 'existing' | 'new' | 'failure' | 'quota' = 'existing';
let statements: string[] = [];
let released = false;
(dataDb as any).connect = async () => ({
  query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes('INSERT INTO assessment_sessions')) return { rowCount: mode === 'existing' ? 0 : 1, rows: [] };
    if (sql.includes('SELECT payload')) return { rows: [{ payload: original }] };
    if (sql.includes('INSERT INTO assessment_evidence') && mode === 'quota') throw new Error('STORAGE_WRITE_LIMIT');
    if (sql.includes('INSERT INTO assessment_evidence') && mode === 'failure') throw new Error('write failed');
    return { rowCount: 1, rows: [] };
  },
  release: () => { released = true; },
});
const input = { workspaceId: 'workspace', assessment: { id: 'visit', coords: { lat: 25, lng: 121 }, baselineClsScore: null },
  evidence: [{ id: 'new-photo', type: 'photo' as const, capturedAt: 1, location: { lat: 25, lng: 121 } }] };
try {
  assert.deepEqual(await saveAssessmentSession(input), original, 'retry must return the historical record unchanged');
  assert.equal(statements.some(sql => /DELETE|UPDATE assessment_evidence/.test(sql)), false);
  assert.equal(statements.some(sql => sql.includes('INSERT INTO assessment_evidence')), false);
  assert.equal(released, true);
  mode = 'failure'; statements = []; released = false;
  await assert.rejects(saveAssessmentSession(input), /write failed/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(released, true);
  mode = 'quota'; statements = [];
  await assert.rejects(saveAssessmentSession(input), /STORAGE_WRITE_LIMIT/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  mode = 'new'; statements = [];
  await saveAssessmentSession(input);
  assert.ok(statements.includes('COMMIT'));
  assert.equal(statements.some(sql => sql.includes('photo_data =')), false);
  console.log('Safe writes: idempotent history, preserved photo bytes, atomic rollback.');
} finally { await dataDb?.end(); }
