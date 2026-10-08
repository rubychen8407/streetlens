import assert from 'node:assert/strict';
import { parseWheelRouteGeometry } from '../wheelRouteGeometry';
import { fetchTaipeiSidewalkAreas, OFFICIAL_SOURCE_URLS } from '../official';

// Unmodified bounded observation from the official kind-12 endpoint,
// retrieved 2026-10-07. This fixture is test-only, never production fallback.
const fixture = {
  kind: '12', kname: '43321-標線型人行道',
  location: '121.544930327182|25.0590084763098|121.54493014717|25.0589970848544|121.546097716081|25.0589819444146|121.546097896093|25.0589933358714|121.544930327182|25.0590084763098|',
  width: -1, slope: -1,
};
const geometry = parseWheelRouteGeometry(fixture)!;
assert.equal(geometry.type, 'Polygon');
assert.equal(geometry.coordinates[0].length, 5, 'closed source rings are not closed twice');
assert.deepEqual(geometry.coordinates[0][0], [121.544930327182, 25.0590084763098], 'preserve longitude/latitude order and precision');
assert.deepEqual(parseWheelRouteGeometry({ ...fixture, kind: '11' }), geometry, 'both polygon facility kinds share the published encoding');
const vertices = fixture.location.split('|').slice(0, -1);
assert.deepEqual(parseWheelRouteGeometry({ ...fixture, location: vertices.slice(0, -2).join('|') }), geometry, 'closing only repeats an existing vertex');
for (const location of ['', '121|25|121|26|', '121|25|121||122|26', '121|25|122|26|123', 'NaN|25|122|26|123|27', '200|25|122|26|123|27', '121|95|122|26|123|27', '121|25|121|25|121|25']) {
  assert.equal(parseWheelRouteGeometry({ ...fixture, location }), null, 'malformed coordinates must never become observations');
}
assert.equal(parseWheelRouteGeometry({ ...fixture, kind: '1' }), null, 'point facilities are not polygons');
const originalFetch = globalThis.fetch;
let mode: 'native' | 'geojson' | 'empty' | 'error' = 'native';
const calls: string[] = [];
globalThis.fetch = async (input: any) => {
  const url = String(input); calls.push(url);
  assert.ok([OFFICIAL_SOURCE_URLS.wheelRouteFacility11, OFFICIAL_SOURCE_URLS.wheelRouteFacility12].includes(url));
  if (mode === 'error') throw new Error('source offline');
  const payload = url.endsWith('/11') ? [] : mode === 'native' ? [fixture, fixture, { ...fixture, width: 1.4 }]
    : mode === 'geojson' ? [{ id: 'geojson', name: 'existing geometry', geometry }] : [];
  return new Response(JSON.stringify(payload), { headers: { 'Last-Modified': 'Wed, 07 Oct 2026 00:00:00 GMT' } });
};
try {
  const parsed = await fetchTaipeiSidewalkAreas();
  assert.equal(parsed.status, 'available');
  assert.equal(parsed.areas?.length, 2, 'deduplicate exact repeats without dropping distinct content under shared names');
  assert.equal(new Set(parsed.areas!.map(a => a.id)).size, 2);
  assert.ok(parsed.areas!.every(a => a.name === fixture.kname && a.properties.facilityType === 12));
  assert.deepEqual(parsed.areas![0].geometry, geometry);
  assert.equal(parsed.areas![0].properties.widthCm, null, 'do not infer undocumented units or promote -1 to evidence');
  assert.equal(parsed.areas![0].properties.sourceWidth, -1);
  assert.equal(parsed.sourceUpdatedAt, 'Wed, 07 Oct 2026 00:00:00 GMT');
  mode = 'geojson';
  assert.equal((await fetchTaipeiSidewalkAreas()).areas?.length, 1, 'keep existing GeoJSON support');
  mode = 'empty';
  assert.equal((await fetchTaipeiSidewalkAreas()).status, 'empty', 'an empty feed is not success');
  mode = 'error';
  assert.equal((await fetchTaipeiSidewalkAreas()).status, 'error', 'network failure is not an empty observation');
  assert.equal(calls.length, 8);
  globalThis.fetch = async input => new Response(String(input).endsWith('/11') ? '{broken' : JSON.stringify([fixture]));
  const partial = await fetchTaipeiSidewalkAreas();
  assert.equal(partial.status, 'error', 'invalid JSON in one required facility feed must not replace the complete inventory');
  assert.equal(partial.areas?.length, 0);
  assert.match(partial.error!, /facility 11 returned invalid JSON/);
  console.log('WheelRoute native coordinates, names, precision, closed rings, validation, deduplication and adapter failures passed.');
} finally { globalThis.fetch = originalFetch; }
