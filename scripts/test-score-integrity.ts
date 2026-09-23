import assert from "node:assert/strict";
import { applyFieldObservationAdjustment, calculateAssessment, validateAssessmentIntegrity } from "../scoring.ts";

const baseline = {};
const emptyAssessment = calculateAssessment(baseline, {});
const emptyValidation = validateAssessmentIntegrity(emptyAssessment);
assert.equal(emptyValidation.valid, true, emptyValidation.errors.join("; "));
assert.equal(emptyAssessment.overall, null, "overall must be unavailable when categories are incomplete");

const percentileAssessment = calculateAssessment(
  baseline,
  {},
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  Array.from({ length: 19 }, (_, index) => index + 1),
);
assert.equal(percentileAssessment.overall, 50, "real reference data should provide a transparent regional estimate");
assert.equal(percentileAssessment.overallMode, "estimated");
assert.equal(percentileAssessment.c2.mode, "estimated");
assert.equal(percentileAssessment.c2.estimationMethod, "regional_real_data_prior");
assert.equal(percentileAssessment.c2.estimationReferenceSampleSize, 19);

const unavailableAssessment = {
  ...emptyAssessment,
  c1: {
    ...emptyAssessment.c1,
    factors: [{
      ...emptyAssessment.c1.factors[0],
      value: 1,
      status: "unavailable" as const,
    }],
  },
};
const unavailableValidation = validateAssessmentIntegrity(unavailableAssessment);
assert.equal(unavailableValidation.valid, false, "unavailable factors must not carry numeric values");

const unchanged = applyFieldObservationAdjustment(80, {});
assert.equal(unchanged.adjustedCls, 80);
assert.equal(unchanged.adjustment, 0);
assert.equal(unchanged.ratedItemCount, 0);

const positiveObservation = applyFieldObservationAdjustment(80, {
  c3_sidewalk_quality: 4,
});
assert.equal(positiveObservation.adjustedCls, 82);
assert.equal(positiveObservation.adjustment, 2);
assert.equal(positiveObservation.categoryAdjustments.C3, 8);

const negativeObservation = applyFieldObservationAdjustment(80, {
  c3_sidewalk_blocked: 4,
});
assert.equal(negativeObservation.adjustedCls, 78);
assert.equal(negativeObservation.adjustment, -2);
assert.equal(negativeObservation.categoryAdjustments.C3, -10);

const balancedObservation = applyFieldObservationAdjustment(80, {
  c3_sidewalk_quality: 4,
  c3_sidewalk_blocked: 4,
});
assert.equal(balancedObservation.adjustedCls, 80);
assert.equal(balancedObservation.adjustment, 0);

const cappedObservation = applyFieldObservationAdjustment(80, {
  c1_lighting: 4,
  c1_cctv: 4,
  c1_flood_mark: 4,
});
assert.equal(cappedObservation.categoryAdjustments.C1, 10, "category observation adjustment must be capped at +10");
assert.equal(cappedObservation.adjustedCls, 82, "C1 cap should contribute +2 to equal-weight CLS");

const unavailableBaseline = applyFieldObservationAdjustment(null, {
  c1_lighting: 4,
});
assert.equal(unavailableBaseline.adjustedCls, null);
assert.equal(unavailableBaseline.adjustment, 0);

console.log("Score integrity checks passed.");
