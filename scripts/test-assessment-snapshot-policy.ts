import assert from "node:assert/strict";
import { getAssessmentSnapshotStatus } from "../assessmentSnapshotPolicy";

const sourceKeys = [
  "google_places",
  "openstreetmap",
  "tdx_transit",
  "taipei_green",
  "taipei_safety",
  "taipei_flood",
  "open_meteo_air_quality",
];

const pending = getAssessmentSnapshotStatus(
  sourceKeys,
  Object.fromEntries(sourceKeys.map((key) => [key, null])),
);
assert.equal(pending.dataStatus, "pending_refresh");
assert.deepEqual(pending.missingSources, sourceKeys);

const partial = getAssessmentSnapshotStatus(sourceKeys, {
  google_places: { status: "available" },
  openstreetmap: null,
  tdx_transit: { status: "available" },
  taipei_green: null,
  taipei_safety: { status: "available" },
  taipei_flood: null,
  open_meteo_air_quality: null,
});
assert.equal(partial.dataStatus, "cached");
assert.deepEqual(partial.missingSources, [
  "openstreetmap",
  "taipei_green",
  "taipei_flood",
  "open_meteo_air_quality",
]);

const stale = getAssessmentSnapshotStatus(sourceKeys, {
  google_places: { status: "stale" },
  openstreetmap: { status: "available" },
  tdx_transit: { status: "available" },
  taipei_green: { status: "available" },
  taipei_safety: { status: "available" },
  taipei_flood: { status: "available" },
  open_meteo_air_quality: { status: "available" },
});
assert.equal(stale.dataStatus, "cached");
assert.deepEqual(stale.missingSources, []);

console.log("Assessment snapshot policy checks passed.");
