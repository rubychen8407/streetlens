import assert from "node:assert/strict";
import { persistAssessment } from "../src/utils/assessmentApi";
import type { EvidencePhotoDraft, SavedLocation } from "../src/types";

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init?: RequestInit }> = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ url: String(input), init });
  return new Response(JSON.stringify({ id: "saved-1", evidence: [{ id: "photo-1", type: "photo" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

try {
  const assessment = { id: "saved-1", evidence: [{
    id: "photo-1", type: "photo", capturedAt: 1, location: { lat: 25, lng: 121 },
    storageKey: "photo_local_1", note: "路口視線",
  }] } as unknown as SavedLocation;
  const drafts = [{ id: "photo-1", blob: new Blob(["photo-bytes"]), mimeType: "image/jpeg" }] as unknown as EvidencePhotoDraft[];

  const result = await persistAssessment("workspace-1", assessment, drafts);

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1, "saving a report must not send a second image upload request");
  assert.equal(requests[0].url, "/api/assessments");
  const body = JSON.parse(String(requests[0].init?.body));
  assert.equal(body.evidence[0].id, "photo-1");
  assert.equal(body.evidence[0].note, "路口視線");
  assert.equal("storageKey" in body.evidence[0], false, "local IndexedDB keys must not be persisted remotely");
  console.log("Photo storage checks passed: metadata syncs, image bytes stay local.");
} finally {
  globalThis.fetch = originalFetch;
}
