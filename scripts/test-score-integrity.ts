import assert from "node:assert/strict";
import { calculateAssessment, validateAssessmentIntegrity } from "../scoring.ts";

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
assert.equal(percentileAssessment.overall, null, "insufficient reference data must not produce a complete overall score");

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

console.log("Score integrity checks passed.");
