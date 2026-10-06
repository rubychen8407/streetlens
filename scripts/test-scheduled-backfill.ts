import assert from 'node:assert/strict';
import { backfillPendingPage } from '../scheduledScoreBackfill';
import { calculateAssessment } from '../scoring';
import { createSavedStreet } from '../src/utils/savedLocations';

const saved = createSavedStreet({ coords: { lat: 25.03, lng: 121.53 }, streetName: 'street', district: '', city: '' });
let writes = 0;
let queries: string[] = [];
const client = {
  query: async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('SELECT payload')) return { rows: [{ payload: saved }] };
    if (sql.includes('UPDATE assessment_sessions')) writes++;
    return { rows: [] };
  },
  release: () => {},
};
const db = {
  query: async (sql: string, values: unknown[]) => {
    assert.ok(sql.includes('adjusted_cls IS NULL'));
    assert.deepEqual(values, ['cursor']);
    return { rows: [{ id: saved.id, workspace_id: 'workspace', payload: saved }] };
  },
  connect: async () => client,
} as any;
const pending = await backfillPendingPage(db, async () => ({ status: 202, body: {} }), 'cursor');
assert.equal(pending.pending, 1);
assert.equal(writes, 0);
const scores = calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({ length: 19 }, (_, i) => i + 1));
const filled = await backfillPendingPage(db, async () => ({ status: 200, body: {
  location: { ...saved.coords, lat: saved.coords.lat, lng: saved.coords.lng },
  scores: { ...scores, overall: 80 }, factors: [], generatedAt: '2026-10-06T00:00:00Z',
} }), 'cursor');
assert.equal(filled.filled, 1);
assert.equal(writes, 1);
assert.ok(queries.includes('COMMIT'));
assert.equal(queries.some(sql => /DELETE|assessment_evidence/.test(sql)), false);
const failure = await backfillPendingPage(db, async () => { throw new Error('unavailable'); }, 'cursor');
assert.equal(failure.errors, 1);
assert.equal(writes, 1);
console.log('Scheduled backfill: pending stays pending, real scores fill atomically, evidence untouched, failures reported.');
