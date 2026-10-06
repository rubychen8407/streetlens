import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
const { dataDb } = await import('../db');
const { saveAssessmentSession } = await import('../assessmentDb');
const original = { id: 'visit', clsScore: 81, fieldNotes: 'old note', evidence: [{ id: 'old-photo' }] };
let mode: 'existing' | 'new' | 'failure' | 'quota' | 'field-update' = 'existing';
let existingRecord: any = original;
let updatePayload: any;
let failFieldEvidence = false;
let statements: string[] = [];
let released = false;
(dataDb as any).connect = async () => ({
  query: async (sql: string, values?: any[]) => {
    statements.push(sql);
    if (sql.includes('INSERT INTO assessment_sessions')) return { rowCount: mode === 'existing' || mode === 'field-update' ? 0 : 1, rows: [] };
    if (sql.includes('SELECT payload')) return { rows: [{ payload: existingRecord }] };
    if (sql.includes('UPDATE assessment_sessions')) updatePayload = JSON.parse(values![2]);
    if (sql.includes('INSERT INTO assessment_evidence') && mode === 'quota') throw new Error('STORAGE_WRITE_LIMIT');
    if (sql.includes('INSERT INTO assessment_evidence') && mode === 'failure') throw new Error('write failed');
    if (sql.includes('INSERT INTO assessment_evidence') && failFieldEvidence) throw new Error('field metadata failed');
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
  mode = 'field-update'; statements = [];
  existingRecord = { ...original, timestamp: 1, fieldRecord: true, fieldUpdatedAt: 1,
    streetName: 'Street', district: '', city: '', coords: { lat: 25, lng: 121 }, scores: {},
    evidence: [{ id: 'old-photo', type: 'photo', capturedAt: 1, location: { lat: 25, lng: 121 } }] };
  const fieldInput = { ...input, assessment: { ...input.assessment, streetName: 'Street',
    fieldRecord: true, fieldUpdatedAt: 2, timestamp: 2 } };
  const result = await saveAssessmentSession(fieldInput);
  assert.equal(result.id, 'visit');
  assert.equal(result.clsScore, 81);
  assert.equal(result.evidence.length, 2);
  assert.equal(updatePayload.fieldUpdatedAt, 2);
  assert.equal(statements.some(sql => sql.includes('FOR UPDATE')), true);
  assert.equal(statements.some(sql => /DELETE|photo_data =/.test(sql)), false);
  existingRecord = result; statements = []; updatePayload = undefined;
  await saveAssessmentSession(fieldInput);
  assert.equal(updatePayload, undefined, 'retries of the same revision are idempotent');
  failFieldEvidence = true; statements = [];
  await assert.rejects(saveAssessmentSession({ ...fieldInput,
    assessment: { ...fieldInput.assessment, fieldUpdatedAt: 3 } }), /field metadata failed/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false, 'payload and photo metadata update atomically');
  console.log('Safe writes: idempotent history, preserved photo bytes, atomic rollback.');
} finally { await dataDb?.end(); }
