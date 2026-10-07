import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAssessment, applyFieldObservationAdjustment } from '../scoring';
import { backfillSavedScore } from '../savedScoreBackfill';
import { createSavedStreet, favoriteKey, fillSavedScore, mergeSavedRecords, migrateFavoriteKeys, groupSavedStreets } from '../src/utils/savedLocations';
import { normalizeWalkMoment } from '../src/utils/walkMoments';
import { resolveSavedScore } from '../src/utils/savedScoreApi';
import { frameCrop } from '../src/utils/cameraFrame';
import { mergeFieldRecord, upsertFieldRecord } from '../src/utils/fieldRecordMerge';
import { savedScoreLocations, visibleSavedScores } from '../src/utils/savedScoreMap';
import type { StreetAssessmentResponse } from '../src/types';

const now = 1_800_000_000_000;
test('camera captures the visible cover crop in portrait and landscape, bounded to 1280', () => {
  const portrait = frameCrop(1920, 1080, 390, 844);
  assert.equal(portrait.y, 0);
  assert.ok(portrait.x > 0);
  assert.ok(Math.abs(portrait.width / portrait.height - 390 / 844) < 0.00001);
  const landscape = frameCrop(1080, 1920, 844, 390);
  assert.equal(landscape.x, 0);
  assert.ok(landscape.y > 0);
  assert.ok(Math.abs(landscape.width / landscape.height - 844 / 390) < 0.00001);
  assert.equal(Math.max(frameCrop(4000, 3000, 800, 600).outputWidth, frameCrop(4000, 3000, 800, 600).outputHeight), 1280);
  assert.throws(() => frameCrop(0, 1080, 390, 844));
});
const fix = { lat: 25.03, lng: 121.53, accuracy: 12, timestamp: now };
const address = { streetName: '永康街', district: '大安區', city: '臺北市' };
const saved = () => createSavedStreet({ ...address, coords: { lat: fix.lat, lng: fix.lng } });
test('saved map badges use the latest valid completed score without mutating history', () => {
  const visit = (id: string, timestamp: number, clsScore: number | null) => ({...saved(),id,timestamp,clsScore});
  const older = visit('older',1,73.456), latest = visit('latest',2,0), pending = visit('pending',3,null);
  const records = [pending,older,latest,visit('bad',4,NaN),visit('too-high',5,101),visit('negative',6,-1),
    {...visit('bad-coord',7,80),coords:{lat:NaN,lng:121}},
    {...visit('out-of-range',7,80),coords:{lat:91,lng:121}}];
  const before = structuredClone(records);
  assert.deepEqual(savedScoreLocations(records),[latest],'zero is a real score; pending/invalid newer visits are excluded');
  assert.deepEqual(records,before,'map grouping never rewrites personal history');
  assert.deepEqual(savedScoreLocations([pending,older]),[older],'a pending visit does not hide an older real score');
  assert.deepEqual(savedScoreLocations([pending]),[],'pending scores never fabricate a badge');
  assert.equal(savedScoreLocations([visit('a',10,81),visit('b',10,82)])[0].id,'b','timestamp ties are deterministic');
  const points = Array.from({length:300},(_,i)=>({...visit('point-'+i,i,80),streetName:`街道 ${i}`,coords:{lat:25+i/10000,lng:121}}));
  const selected = savedScoreLocations(points);
  assert.equal(visibleSavedScores(selected,{south:24,north:26,west:120,east:122}).length,200,'rendered badge count is bounded');
  assert.equal(visibleSavedScores(selected,{south:20,north:21,west:120,east:122}).length,0,'offscreen records render no DOM');
  assert.equal(visibleSavedScores(selected,{south:25,north:25.001,west:121,east:121}).length,11,'viewport edges remain included');
});
test('field actions merge into one ID; newer feelings win, evidence and CLS survive', () => {
  const photo = { ...saved(), id: 'one', timestamp: 100, evidence: [{ id: 'photo', storageKey: 'local-photo',
    type: 'photo' as const, capturedAt: 100, location: fix }], walkMoment: {
    feeling: 'photo' as const, accuracyMeters: 12, positionTimestamp: 100, confirmedAt: 100, source: 'walk' as const } };
  const like = { ...saved(), timestamp: 200, walkMoment: { ...photo.walkMoment, feeling: 'good' as const } };
  const merged = upsertFieldRecord([photo], like);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'one');
  assert.equal(merged[0].walkMoment?.feeling, 'good');
  assert.equal(merged[0].evidence?.[0].storageKey, 'local-photo');
  const bad = { ...like, timestamp: 300, walkMoment: { ...like.walkMoment, feeling: 'bad' as const } };
  const scored = { ...merged[0], clsScore: 81, baselineClsScore: 81 };
  const updated = upsertFieldRecord([scored], bad)[0];
  assert.equal(updated.walkMoment?.feeling, 'bad');
  assert.equal(updated.clsScore, 81);
  assert.equal(updated.syncStatus, 'local');
  const edited = mergeFieldRecord(updated, { ...bad, fieldUpdatedAt: 350, fieldNotes: 'new note',
    evidence: [{ ...photo.evidence[0], note: 'new caption' }] });
  assert.equal(edited.fieldNotes, 'new note');
  assert.equal(edited.evidence?.[0].note, 'new caption');
  assert.equal(edited.evidence?.[0].storageKey, 'local-photo');
  assert.equal(mergeFieldRecord(updated, { ...photo, timestamp: 400 }).walkMoment?.feeling, 'bad', 'taking another photo retains the feeling');
  const stale = mergeSavedRecords(updated, merged[0]);
  assert.equal(stale.walkMoment?.feeling, 'bad');
  assert.equal(stale.syncStatus, 'local', 'late upload cannot acknowledge newer edits');
  assert.equal(stale.evidence?.[0].storageKey, 'local-photo');
  assert.equal(upsertFieldRecord([updated], { ...like, coords: { lat: 26, lng: 121 } }).length, 2);
});
const snapshot = (score = 50): StreetAssessmentResponse => ({
  location: { ...address, lat: fix.lat, lng: fix.lng },
  scores: { ...calculateAssessment({}, {}, undefined, undefined, undefined, undefined, undefined, Array.from({ length: 19 }, (_, i) => i + 1)), overall: score },
  factors: [], poiCount: 0, dataSources: ['test fixture'], generatedAt: '2026-09-25T00:00:00Z',
});

test('library preserves exact-coordinate reverse-geocoding aliases and every visit', () => {
  const first = { ...saved(), id: 'first', timestamp: 1, clsScore: 0 };
  const second = { ...saved(), id: 'second', timestamp: 2, streetName: 'different geocoded name' };
  const other = { ...saved(), id: 'other', coords: { lat: 25.04, lng: 121.53 } };
  const input = [first, second, other];
  const before = JSON.stringify(input);
  const grouped = groupSavedStreets(input);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].map(item => item.id), ['second', 'first']);
  assert.equal(grouped[0][1].clsScore, 0);
  assert.equal(JSON.stringify(input), before);
});

test('map and library share bounded, deterministic street groups despite GPS drift', () => {
  const first = { ...saved(), id: 'first', timestamp: 1, clsScore: 80 };
  const jitter = { ...first, id: 'jitter', timestamp: 2, city: '台北市', streetName: '臺北市 大安區 永康街',
    coords: { lat: first.coords.lat + 0.0005, lng: first.coords.lng }, clsScore: 78 };
  const nearbyOther = { ...jitter, id: 'other', streetName: '青田街', coords: { ...jitter.coords, lng: jitter.coords.lng + 0.0001 } };
  const far = { ...first, id: 'far', coords: { lat: first.coords.lat + 0.006, lng: first.coords.lng } };
  const chain = { ...jitter, id: 'chain', timestamp: 3, coords: { lat: first.coords.lat + 0.003, lng: first.coords.lng } };
  const input = [jitter, far, nearbyOther, chain, first];
  const before = structuredClone(input);
  const groups = groupSavedStreets(input);
  assert.equal(groups.length, 4, 'different roads, distant portions and radius chains stay separate');
  assert.deepEqual(groups.find(visits => visits.some(v => v.id === 'first'))?.map(v => v.id), ['jitter', 'first']);
  assert.deepEqual(groupSavedStreets([...input].reverse()), groups, 'input order cannot change anchors');
  assert.equal(savedScoreLocations(input).length, groups.length);
  assert.deepEqual(input, before, 'grouping never rewrites records');
  const meta = { streetIdentity: '臺北市:永康街', segmentId: 'one', anchor: first.coords, version: '1', scoringVersion: '1' };
  const known = { ...first, assessmentSnapshot: { ...snapshot(), baseline: meta } };
  const distinct = { ...jitter, assessmentSnapshot: { ...snapshot(), baseline: { ...meta, segmentId: 'two' } } };
  assert.equal(groupSavedStreets([known, distinct]).length, 2, 'distinct canonical segments stay separate');
});

test('legacy walk metadata survives validation without creating new records', () => {
  for (const feeling of ['good', 'bad', 'photo'] as const) {
    const metadata = { feeling, accuracyMeters: 12, positionTimestamp: now, confirmedAt: now, source: 'walk' as const };
    assert.deepEqual(normalizeWalkMoment(metadata), metadata);
    assert.deepEqual(normalizeWalkMoment({ ...metadata, source: 'shortcut' }), { ...metadata, source: 'shortcut' });
    for (const change of [{ feeling: 'great' }, { accuracyMeters: -1 }, { source: 'arbitrary' }, { positionTimestamp: Infinity }]) {
      assert.throws(() => normalizeWalkMoment({ ...metadata, ...change }));
    }
  }
  assert.equal(normalizeWalkMoment(undefined), undefined);
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
