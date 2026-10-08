import assert from 'node:assert/strict';
import { CLS_STANDARDS } from '../src/data/clsStandards';
import { calculateFixedScores, fixedIndicatorScore, type FixedInput } from '../fixedScoring';
import { calculateAssessment, validateAssessmentIntegrity } from '../scoring';

// Synthetic values below are deterministic test inputs only, never source data.
for (const [id, standard] of Object.entries(CLS_STANDARDS)) {
  for (const missing of [null, undefined, NaN, Infinity, -1, '', '0', false]) {
    assert.equal(fixedIndicatorScore(missing, standard), null, `${id}: invalid values are not observed zero`);
  }
  let previous = fixedIndicatorScore(0, standard)!;
  const max = standard.maxValue ?? (standard.curve.kind === 'saturation' ? standard.curve.half * 10 : standard.curve.knots.at(-1)![0] * 2);
  for (let i = 1; i <= 100; i++) {
    const score = fixedIndicatorScore(i * max / 100, standard)!;
    assert.ok(score >= 0 && score <= 100, id);
    assert.ok(standard.direction === 'higher_is_better' ? score >= previous : score <= previous, `${id}: monotone in the correct direction`);
    previous = score;
  }
  if (standard.curve.kind === 'saturation') assert.equal(fixedIndicatorScore(standard.curve.half, standard), 50, id);
}
for (const category of ['C1', 'C2', 'C3', 'C4', 'C5']) {
  assert.ok(Math.abs(Object.values(CLS_STANDARDS).filter(s => s.category === category).reduce((sum, s) => sum + s.weight, 0) - 1) < 1e-9);
}
assert.equal(fixedIndicatorScore(400, CLS_STANDARDS.supermarketDist), 92.5, 'interpolates product knots');
assert.equal(fixedIndicatorScore(500, CLS_STANDARDS.mrtOrRailDist), 100, 'rail has its own accessibility threshold');
assert.equal(fixedIndicatorScore(101, CLS_STANDARDS.sidewalkCoverage500mPct), null);

const inputs = Object.fromEntries(Object.entries(CLS_STANDARDS).map(([id, s]) => [id, {
  value: s.curve.kind === 'saturation' ? s.curve.half : s.curve.knots[2][0], source: 'test-only',
}])) as Record<string, FixedInput>;
const complete = calculateFixedScores(inputs);
assert.equal(complete.completeness, 100);
assert.equal(complete.provisional, false);
assert.equal(complete.overallMode, 'observed');
assert.equal(complete.overall, Math.round((complete.c1.score! + complete.c2.score! + complete.c3.score! + complete.c4.score! + complete.c5.score!) / 5));
assert.ok(validateAssessmentIntegrity(complete).valid);
const otherReferences = Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, { ...input, reference: Array(40).fill(0) }]));
const changedCohort = calculateFixedScores(otherReferences);
assert.equal(changedCohort.overall, complete.overall, 'observed CLS never changes with cohort composition');
for (const category of ['c1', 'c2', 'c3', 'c4', 'c5'] as const) assert.equal(changedCohort[category].score, complete[category].score);

const allMissing = calculateFixedScores({});
assert.equal(allMissing.overall, null);
assert.equal(allMissing.completeness, 0);
assert.equal(allMissing.provisional, true);
const sparse = calculateFixedScores({ busStopDist: { value: 0 } });
assert.equal(sparse.c3.score, 100, 'real zero distance remains an observation');
assert.equal(sparse.c3.completeness, 20);
assert.equal(sparse.completeness, 4);
assert.equal(sparse.provisional, true, 'one good input cannot look like a complete score');
assert.equal(sparse.confidence, 'low');
const tooFew = calculateFixedScores({ busStopDist: { value: null, reference: [100, 100, 100, 100] } });
assert.equal(tooFew.c3.score, null);
const estimated = calculateFixedScores({ busStopDist: { reference: [100, 200, 400, 600, 1000] } });
assert.equal(estimated.c3.score, 85);
assert.equal(estimated.c3.mode, 'estimated');
assert.equal(estimated.completeness, 0);
const estimatedFactor = estimated.c3.factors.find(f => f.indicator === 'busStopDist')!;
assert.equal(estimatedFactor.value, null);
assert.equal(estimatedFactor.status, 'unavailable');
assert.equal(estimatedFactor.estimatedValue, 400);
assert.equal(estimatedFactor.referenceSampleSize, 5);
assert.ok(validateAssessmentIntegrity(estimated).valid);
const partial = calculateFixedScores({ ...inputs, busStopDist: { reference: Array(5).fill(400) } });
assert.equal(partial.provisional, false, 'all fixed weights resolved, one explicitly estimated');
assert.equal(partial.completeness, 96, 'estimates do not inflate completeness');
assert.equal(partial.c3.mode, 'estimated');
const ties = calculateFixedScores({ busStopDist: { value: 200, reference: Array(20).fill(200) } });
assert.equal(ties.c3.factors.find(f => f.indicator === 'busStopDist')?.referencePercentile, 50);
const lower = calculateFixedScores({ busStopDist: { value: 100, reference: Array(20).fill(200) } });
assert.equal(lower.c3.factors.find(f => f.indicator === 'busStopDist')?.referencePercentile, 100);

const infrastructureOnly = calculateFixedScores({ streetLightCount300m: { value: 1000 }, fireHydrantCount500m: { value: 1000 } });
assert.equal(infrastructureOnly.c1.score, null, 'no invented safety from infrastructure alone');
const risky = calculateFixedScores({ ...inputs, maxFloodDepthCm: { value: 100 }, trafficAccidentCount500m: { value: 0 }, streetLightCount300m: { value: 1000 }, fireHydrantCount500m: { value: 1000 } });
assert.ok(risky.c1.score! <= 10, 'severe modeled flood risk cannot be cancelled by infrastructure or accident counts');
const unknownFlood = calculateAssessment({}, {}, undefined, { source: 'test-only', method: 'official', confidence: 'high',
  floodHazard: [{ scenarioMmPerHour: 100, depthCm: null, distanceMeters: 0, source: 'test-only', sourceType: 'official_model', retrievedAt: '2026-10-07T00:00:00Z' }] });
assert.equal(unknownFlood.c1.score, null, 'null modeled depth is not zero flood risk');
assert.equal(unknownFlood.c1.factors.find(f => f.indicator === 'maxFloodDepthCm')?.value, null);
console.log('Fixed scoring: monotonicity, null/zero separation, equal category weights, transparent estimates, completeness, cohort invariance and risk caps passed.');
