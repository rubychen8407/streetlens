import assert from "node:assert/strict";
import { hashPayload, shouldPreserveExistingSnapshot } from "../db.ts";

const payload = {
  status: "available",
  value: 42,
  nested: { source: "official", items: [1, 2, 3] },
};
const hash = hashPayload(payload);

assert.equal(
  shouldPreserveExistingSnapshot({ contentHash: hash }, hash),
  true,
  "identical payloads must preserve the existing snapshot",
);

assert.equal(
  shouldPreserveExistingSnapshot({ contentHash: hash }, hashPayload({ ...payload, value: 43 })),
  false,
  "changed payloads must create a new snapshot version",
);

assert.equal(
  shouldPreserveExistingSnapshot(null, hash),
  false,
  "missing snapshots cannot be preserved",
);

console.log("Snapshot preservation checks passed.");
