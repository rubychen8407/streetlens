import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAssessment, applyFieldObservationAdjustment } from '../scoring';
import { backfillSavedScore } from '../savedScoreBackfill';
import { createSavedStreet, favoriteKey, fillSavedScore, mergeSavedRecords, migrateFavoriteKeys } from '../src/utils/savedLocations';
import { canRecordWalk, createWalkMoment, isWalkShortcut, normalizeWalkMoment, usableFix, walkShortcutUrl } from '../src/utils/walkMoments';
import { resolveSavedScore } from '../src/utils/savedScoreApi';
import type { StreetAssessmentResponse } from '../src/types';

const now = 1_800_000_000_000;
const fix = { lat: 25.03, lng: 121.53, accuracy: 12, timestamp: now };
const address = { streetName: '永康街', district: '大安區', city: '臺北市' };
const saved = () => createSavedStreet({ ...address, coords: { lat: fix.lat, lng: fix.lng } });
const snapshot = (score = 50): StreetAssessmentResponse => ({
  location: { ...address, lat: fix.lat, lng: fix.lng },
  scores: { ...calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({ length: 19 }, (_, i) => i + 1)), overall: score },
  factors: [], poiCount: 0, dataSources: ['test fixture'], generatedAt: '2026-09-25T00:00:00Z',
});

test('location requires real, recent, accurate GPS and explicit confirmation', () => {
  assert.equal(usableFix(null, now), false);
  for (const broken of [{ ...fix, accuracy: 51 }, { ...fix, accuracy: NaN }, { ...fix, timestamp: now - 20_001 }, { ...fix, timestamp: now + 60_000 }, { ...fix, lat: 91 }]) {
    assert.equal(usableFix(broken, now), false);
  }
  assert.equal(usableFix({ ...fix, accuracy: 0 }, now), true);
  assert.equal(canRecordWalk(fix, null, now), false);
  assert.equal(canRecordWalk(fix, fix, now), true);
  assert.equal(canRecordWalk({ ...fix, lat: fix.lat + 0.001 }, fix, now), false);
});

test('feelings and photos never manufacture CLS or field ratings', () => {
  for (const feeling of ['good', 'bad', 'photo'] as const) {
    const record = createWalkMoment(fix, fix, now, feeling, address, 'walk', now);
    assert.equal(record.clsScore, null);
    assert.deepEqual(record.observationRatings, {});
    assert.equal(record.walkMoment?.feeling, feeling);
    assert.equal(record.walkMoment?.accuracyMeters, 12);
    assert.deepEqual(record.coords, { lat: fix.lat, lng: fix.lng });
  }
  assert.throws(() => createWalkMoment(fix, null, now, 'good', address, 'walk', now));
});

test('shortcut URLs only select a mode and preserve the app path', () => {
  assert.equal(isWalkShortcut('?mode=walk&feeling=good'), true);
  assert.equal(isWalkShortcut('?feeling=good'), false);
  assert.equal(walkShortcutUrl('https://example.com/streetlens?token=private#old'), 'https://example.com/streetlens?mode=walk');
});

test('walk metadata rejects invalid feelings and non-finite accuracy', () => {
  const record = createWalkMoment(fix, fix, now, 'bad', address, 'shortcut', now);
  assert.deepEqual(normalizeWalkMoment(record.walkMoment), record.walkMoment);
  assert.equal(normalizeWalkMoment(undefined), undefined);
  for (const change of [{ feeling: 'great' }, { accuracyMeters: -1 }, { source: 'arbitrary' }, { positionTimestamp: Infinity }]) {
    assert.throws(() => normalizeWalkMoment({ ...record.walkMoment, ...change }));
  }
});

test('saving while another location loads does not attach the previous CLS', () => {
  const other = { ...snapshot(), location: { ...snapshot().location, lat: 24 } };
  assert.equal(createSavedStreet({ ...address, coords: fix }, other).clsScore, null);
});

test('backfill preserves evidence, visit time, notes, names and real field ratings', () => {
  const original = { ...saved(), name: 'My walk', fieldNotes: 'Keep this', timestamp: now,
    observationRatings: { c3_sidewalk_quality: 4 }, evidence: [{ id: 'photo', storageKey: 'local-photo', type: 'photo' as const, capturedAt: now, location: fix }] };
  const adjusted = applyFieldObservationAdjustment(50, original.observationRatings);
  const filled = fillSavedScore(original, snapshot(), adjusted);
  assert.equal(filled.clsScore, 52);
  assert.equal(filled.baselineClsScore, 50);
  assert.equal(filled.fieldAdjustment, 2);
  assert.equal(filled.timestamp, original.timestamp);
  assert.equal(filled.name, original.name);
  assert.equal(filled.fieldNotes, original.fieldNotes);
  assert.deepEqual(filled.evidence, original.evidence);
  assert.equal(filled.assessmentSnapshot?.scores.overallMode, 'estimated');
  assert.equal(filled.scoreUpdatedAt, snapshot().generatedAt);
});

test('zero is a valid score and completed historical scores are immutable', () => {
  const original = saved();
  const zero = fillSavedScore(original, snapshot(0), applyFieldObservationAdjustment(0, {}));
  assert.equal(zero.clsScore, 0);
  assert.equal(zero.grade, 'D');
  assert.equal(fillSavedScore(zero, snapshot(70), applyFieldObservationAdjustment(70, {})), zero);
});

test('mismatched location, null baseline or adjustment cannot backfill', () => {
  const original = saved();
  assert.equal(fillSavedScore(original, { ...snapshot(), location: { ...snapshot().location, lat: 24 } }, applyFieldObservationAdjustment(50, {})), original);
  assert.equal(fillSavedScore(original, snapshot(), applyFieldObservationAdjustment(60, {})), original);
  assert.equal(fillSavedScore(original, { ...snapshot(), scores: { ...snapshot().scores, overall: null } }, applyFieldObservationAdjustment(null, {})), original);
});

test('legacy favorites migrate once without fake CLS or lost colon-containing names', () => {
  const key = favoriteKey(fix, '中山:路');
  const migrated = migrateFavoriteKeys([], [key, key, 'malformed', 'NaN:121:x']);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].streetName, '中山:路');
  assert.equal(migrated[0].clsScore, null);
  assert.equal(migrateFavoriteKeys(migrated, [key]).length, 1);
});

test('late cloud history cannot erase completed score or local photo key', () => {
  const original = { ...saved(), evidence: [{ id: 'photo', storageKey: 'local', type: 'photo' as const, capturedAt: now, location: fix }] };
  const filled = fillSavedScore(original, snapshot(), applyFieldObservationAdjustment(50, {}));
  const merged = mergeSavedRecords(filled, { ...original, evidence: [{ ...original.evidence[0], storageKey: undefined }] });
  assert.equal(merged.clsScore, 50);
  assert.equal(merged.evidence?.[0].storageKey, 'local');
  assert.equal(merged.scoreSyncPending, true, 'completed local score still needs server backfill');
  assert.equal(mergeSavedRecords(merged, filled).scoreSyncPending, false);
});

test('pending/failed backend requests never manufacture a saved score', async () => {
  const original = saved();
  for (const status of [202, 503]) {
    const result = await resolveSavedScore(original, 'workspace', new AbortController().signal,
      async () => new Response(JSON.stringify({ dataStatus: 'pending_refresh' }), { status }));
    assert.equal(result.clsScore, null);
  }
});

test('local backfill uses each saved coordinate and asks backend for its own adjustment', async () => {
  const original = { ...saved(), observationRatings: { c3_sidewalk_quality: 4 } };
  const calls: Array<{ url: string; body?: string }> = [];
  const result = await resolveSavedScore(original, 'workspace', new AbortController().signal, async (url, options) => {
    calls.push({ url: String(url), body: options?.body as string });
    return new Response(JSON.stringify(String(url).includes('field-adjustment')
      ? applyFieldObservationAdjustment(50, original.observationRatings) : snapshot()));
  });
  assert.match(calls[0].url, /lat=25.03&lng=121.53/);
  assert.deepEqual(JSON.parse(calls[1].body!), { baselineCls: 50, ratings: original.observationRatings });
  assert.equal(result.clsScore, 52);
});

test('remote score requests contain identity only, not client-supplied scores', async () => {
  const original = { ...saved(), syncStatus: 'synced' as const };
  const result = await resolveSavedScore(original, 'workspace', new AbortController().signal, async (url, options) => {
    assert.match(String(url), /\/score\?workspaceId=workspace$/);
    assert.equal(options?.method, 'POST'); assert.equal(options?.body, undefined);
    return new Response(JSON.stringify(fillSavedScore(original, snapshot(), applyFieldObservationAdjustment(50, {}))));
  });
  assert.equal(result.clsScore, 50);
});

function database(original: ReturnType<typeof saved> | null, failUpdate = false) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.startsWith('UPDATE') && failUpdate) throw new Error('write failed');
      return { rows: sql.startsWith('SELECT') && original ? [{ payload: original }] : [] };
    },
    release: () => { released = true; },
  };
  return { pool: { connect: async () => client } as unknown as Parameters<typeof backfillSavedScore>[0], queries, released: () => released };
}

test('server backfill locks the workspace row and does not touch photo/evidence tables', async () => {
  const original = saved(), db = database(original);
  const result = await backfillSavedScore(db.pool, 'workspace', original.id, snapshot());
  assert.equal(result?.clsScore, 50);
  assert.match(db.queries[1].sql, /workspace_id = \$2 FOR UPDATE/);
  assert.deepEqual(db.queries[1].params, [original.id, 'workspace']);
  assert.equal(db.queries.some(query => /assessment_evidence|DELETE|INSERT/.test(query.sql)), false);
  assert.equal(db.queries.at(-1)?.sql, 'COMMIT'); assert.equal(db.released(), true);
});

test('deleted or already-filled rows cannot be recreated or overwritten by late backfill', async () => {
  const missing = database(null);
  assert.equal(await backfillSavedScore(missing.pool, 'workspace', 'deleted', snapshot()), null);
  assert.equal(missing.queries.some(query => query.sql.startsWith('UPDATE')), false);
  const complete = { ...saved(), clsScore: 0 }, db = database(complete);
  assert.equal((await backfillSavedScore(db.pool, 'workspace', complete.id, snapshot()))?.clsScore, 0);
  assert.equal(db.queries.some(query => query.sql.startsWith('UPDATE')), false);
});

test('backfill failures roll back and release the connection', async () => {
  const original = saved(), db = database(original, true);
  await assert.rejects(backfillSavedScore(db.pool, 'workspace', original.id, snapshot()), /write failed/);
  assert.equal(db.queries.at(-1)?.sql, 'ROLLBACK'); assert.equal(db.released(), true);
});
