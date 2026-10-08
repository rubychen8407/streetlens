import assert from 'node:assert/strict';
import { csvRecords, utf8Chunks } from '../streamingCsv';
import { fetchTaipeiStreetLights } from '../official';
import { normalizeSpatialInventory } from '../spatialInventory';

const text = '\uFEFFid,name,note\r\n1,"松山,路燈","first\r\nsecond ""quoted"""\r\n2,plain,\r\n\r\n3,last';
const bytes = new TextEncoder().encode(text);
function stream(bytes: Uint8Array, size: number) {
  let index = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (index >= bytes.length) return controller.close();
    controller.enqueue(bytes.subarray(index, index + size)); index += size;
  } });
}
for (const size of [1, 2, 3, 7, 64, 1024]) {
  const rows = [];
  for await (const row of csvRecords(utf8Chunks(stream(bytes, size)))) rows.push(row);
  assert.deepEqual(rows, [
    { id: '1', name: '松山,路燈', note: 'first\r\nsecond "quoted"' },
    { id: '2', name: 'plain', note: '' }, { id: '3', name: 'last', note: '' },
  ], `UTF-8, CRLF and quote boundaries at ${size} byte chunks`);
}
await assert.rejects(async () => {
  for await (const _ of csvRecords(utf8Chunks(stream(new TextEncoder().encode('id,name\n1,"incomplete'), 3)))) {}
}, /quoted field/);

// Test-only inventory, never a production fallback. Verify adapter compatibility.
const original = globalThis.fetch;
try {
  const csv = 'SerialNumber,緯度,經度,Quantity,LightKind1,UpdDate\nL1,25.03,121.53,2,"A,B",2025-01-01\nL2,,,1,C,2025-02-01\n';
  globalThis.fetch = async () => {
    const response = new Response(stream(new TextEncoder().encode(csv), 5));
    response.text = async () => { throw new Error('must not materialize full CSV'); };
    return response;
  };
  const result = await fetchTaipeiStreetLights();
  assert.equal(result.status, 'available');
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].id, 'L1');
  assert.equal(result.points[0].properties.quantity, 2);
  assert.equal(result.points[0].properties.lightKind, 'A,B');
  assert.equal(result.sourceUpdatedAt, '2025-02-01T00:00:00.000Z', 'preserve update date from all rows');
  globalThis.fetch = async () => new Response('offline', { status: 503 });
  assert.equal((await fetchTaipeiStreetLights()).status, 'error');
  globalThis.fetch = async () => new Response(stream(new TextEncoder().encode(csv + 'L3,"truncated'), 5));
  const broken = await fetchTaipeiStreetLights();
  assert.equal(broken.status, 'error');
  assert.equal(broken.points.length, 0, 'never publish a partly parsed inventory');
} finally { globalThis.fetch = original; }

const unique = { id: 'unique', toJSON() { throw new Error('unique IDs should not retain serialized copies'); } };
assert.equal(normalizeSpatialInventory([unique])[0], unique);
const a = { id: 'a', value: 1 }, b = { id: 'b', value: 1 }, conflict = { id: 'a', value: 2 };
const normalized = normalizeSpatialInventory([a, b, a, conflict]);
assert.equal(normalized.length, 3);
assert.deepEqual(normalizeSpatialInventory([conflict, a, b]).map(x => x.id).sort(), normalized.map(x => x.id).sort());
assert.deepEqual(normalizeSpatialInventory(normalized), normalized);
console.log('Streaming CSV boundaries, partial-source preservation, official adapter and bounded deduplication passed.');
