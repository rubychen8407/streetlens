import assert from 'node:assert/strict';
import { loadUnifiedBaseline, overlaySavedBaselines } from '../streetBaselineStore';
import { streetIdentity, rebaseSavedStreet } from '../src/utils/streetBaseline';
import { createSavedStreet } from '../src/utils/savedLocations';
import { calculateAssessment } from '../scoring';
import type { StreetAssessmentResponse } from '../src/types';
import { backfillSavedScore } from '../savedScoreBackfill';

const rows: any[] = [];
let revision = 'source-a', computations = 0;
const statements: string[] = [];
const query = async (sql: string, values: any[] = []) => {
  statements.push(sql);
  if (sql.includes('AS revision')) return { rows: [{ revision }] };
  if (sql.includes('SELECT id::text')) return { rows: rows.filter(row => row.street_identity === values[0] && Math.abs(row.lat - values[1]) <= 0.003) };
  if (sql.includes('INSERT INTO street_baselines')) {
    const row = { id: String(rows.length + 1), street_identity: values[0], lat: values[1], lng: values[2] };
    rows.push(row); return { rows: [row] };
  }
  if (sql.startsWith('SELECT payload') && sql.includes('street_identity = ANY')) return { rows: rows.filter(row => values[0].includes(row.street_identity) && row.payload) };
  if (sql.startsWith('SELECT payload')) return { rows: rows.filter(row => row.id === values[0] && row.revision === values[1]) };
  if (sql.startsWith('UPDATE street_baselines')) Object.assign(rows.find(row => row.id === values[0]), { revision: values[1], payload: JSON.parse(values[2]) });
  return { rows: [] };
};
const db = { query, connect: async () => ({ query, release() {} }) } as any;
const location = { lat: 25.03, lng: 121.53, city: '台北市', district: '大安區', streetName: '永康街' };
const scores = calculateAssessment({}, {});
const compute = async (point: typeof location) => {
  computations++;
  return { status: 200, body: { location: point, scores: { ...scores, overall: 70 + computations }, factors: [], generatedAt: '2026-10-06T00:00:00Z', poiCount: 0, dataSources: [] } };
};
const first = (await loadUnifiedBaseline(db, location, compute)).body as StreetAssessmentResponse;
const nearby = { ...location, lat: 25.031, streetName: '大安區 永康街' };
const second = (await loadUnifiedBaseline(db, nearby, compute)).body as StreetAssessmentResponse;
assert.equal(first.scores.overall, second.scores.overall);
assert.equal(first.baseline?.version, second.baseline?.version);
assert.deepEqual(second.location, nearby, 'retain requested visit/evidence coordinate');
assert.deepEqual(first.baseline?.anchor, { lat: location.lat, lng: location.lng }, 'observed coordinate, not fabricated centre');
assert.equal(computations, 1, 'unchanged source reads reuse baseline despite reference sample growth');
assert.equal(streetIdentity('台北市', '大安區', '台北市大安區永康街'), streetIdentity('臺北市', '', '永康街'));
const far = (await loadUnifiedBaseline(db, { ...location, lat: 25.04 }, compute)).body;
assert.notEqual(far.baseline.segmentId, first.baseline?.segmentId);
const other = (await loadUnifiedBaseline(db, { ...location, streetName: '信義路' }, compute)).body;
assert.notEqual(other.baseline.segmentId, first.baseline?.segmentId);
const evidence = [{ id: 'photo', type: 'photo' as const, capturedAt: 1, location, storageKey: 'original-photo' }];
const saved = { ...createSavedStreet({ coords: nearby, ...nearby }), clsScore: 42, baselineClsScore: 40, fieldAdjustment: 2,
  observationRatings: { c3_sidewalk_quality: 4 }, evidence, fieldNotes: '原始筆記' };
const rebased = rebaseSavedStreet(saved, second);
assert.equal(rebased.clsScore, first.scores.overall! + 2);
assert.equal(rebased.fieldAdjustment, 2);
assert.equal(rebased.evidence, evidence);
assert.equal(rebased.observationRatings, saved.observationRatings);
assert.equal(rebased.timestamp, saved.timestamp);
assert.equal(rebased.fieldNotes, saved.fieldNotes);
assert.equal(rebaseSavedStreet(rebased, second), rebased);
assert.equal(rebaseSavedStreet(rebased, { ...second, generatedAt: '2026-10-05T00:00:00Z',
  baseline: { ...second.baseline!, version: 'older' } }), rebased, 'late baseline cannot roll a visit back');
assert.equal(rebaseSavedStreet(saved, { ...second, baseline: { ...second.baseline!, anchor: { lat: 24, lng: 121 } } }), saved);
assert.equal(rebaseSavedStreet(saved, { ...second, scores: { ...second.scores, overall: null } }), saved);
assert.equal(rebaseSavedStreet({ ...saved, fieldAdjustment: 40 }, second).clsScore, 100);
assert.equal(rebaseSavedStreet({ ...saved, fieldAdjustment: 40 }, second).fieldAdjustment, 40, 'clamp final score, not stored points');
assert.equal(rebaseSavedStreet({ ...saved, fieldAdjustment: undefined }, second).fieldAdjustment, 2, 'recover legacy delta');
const beforeQueries = statements.length;
const overlay = await overlaySavedBaselines(db, [saved, { ...saved, id: 'visit-2', fieldAdjustment: -3 }]);
assert.equal(statements.length - beforeQueries, 1);
assert.equal(overlay[0].clsScore! - overlay[1].clsScore!, 5);
assert.equal(overlay[0].baselineClsScore, overlay[1].baselineClsScore);
let persisted: any;
const savedDb = { connect: async () => ({ release() {}, query: async (sql: string, values: any[] = []) => {
  if (sql.startsWith('SELECT payload')) return { rows: [{ payload: { ...saved, fieldAdjustment: 5 } }] };
  if (sql.startsWith('UPDATE assessment_sessions')) persisted = JSON.parse(values[4]);
  assert.equal(/assessment_evidence|DELETE/.test(sql), false);
  return { rows: [] };
} }) } as any;
const completed = await backfillSavedScore(savedDb, 'workspace', saved.id, second);
assert.equal(completed?.clsScore, first.scores.overall! + 5, 'backend rebase preserves saved points, not current questionnaire result');
assert.equal(persisted.fieldAdjustment, 5);
assert.deepEqual(persisted.evidence, evidence);
revision = 'source-b';
const updated = (await loadUnifiedBaseline(db, location, compute)).body;
assert.notEqual(updated.baseline.version, first.baseline?.version);
assert.equal(updated.baseline.segmentId, first.baseline?.segmentId);
assert.equal(rows.length, 3, 'one latest baseline row per segment');
const migrating = await loadUnifiedBaseline(db, { ...location, streetName: '和平東路' }, async point => {
  const result = await compute(point); revision = 'source-c'; return result;
});
assert.equal(migrating.status, 202);
assert.equal(rows.at(-1).payload, undefined, 'source transition never commits mixed baseline');
console.log('Unified CLS: stable anchors/versions, delta-only rebase, evidence preservation, source races and bounded library reads passed.');
