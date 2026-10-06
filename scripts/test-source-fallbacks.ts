import assert from 'node:assert/strict';
import { fetchMoenvAirQuality, isSourceFresh, shouldReplaceInventory, poiIdentity, withinStaticCoverage } from '../sourceFallbacks';
import { validateStaticImport, staticPointsToPois } from '../staticOsm';
const recent = new Date().toISOString();
const old = new Date(Date.now() - 40 * 86400_000).toISOString();
assert.equal(isSourceFresh(old, 30 * 86400_000), false);
assert.equal(isSourceFresh('invalid', 1000), false);
assert.equal(isSourceFresh(new Date(Date.now() + 3600000).toISOString(), 1000), false);
assert.equal(shouldReplaceInventory({ status: 'empty', points: [] }), false, 'empty upstream must preserve last-good inventory');
assert.equal(shouldReplaceInventory({ status: 'error', points: [] }), false);
assert.equal(shouldReplaceInventory({ status: 'available', points: [], lines: [{}] }), true);
let calls = 0;
const missing = await fetchMoenvAirQuality('', (async () => { calls++; throw new Error(); }) as typeof fetch);
assert.equal(missing.status, 'error'); assert.equal(calls, 0);
const response = await fetchMoenvAirQuality('test-secret', (async () => new Response(JSON.stringify({ records: [
  { siteid: '1', sitename: 'Test fixture', aqi: '42', 'pm2.5': '', latitude: '25.03', longitude: '121.56', publishtime: recent },
  { siteid: '2', aqi: '', latitude: '25.03', longitude: '121.56', publishtime: recent },
  { siteid: '3', aqi: '50', latitude: '25.03', longitude: '121.56', publishtime: old },
]}))) as typeof fetch);
assert.equal(response.status, 'available'); assert.equal(response.points.length, 1);
assert.equal(response.points[0].properties.pm25, null, 'empty PM2.5 must not become zero');
const error = await fetchMoenvAirQuality('test-secret', (async () => { throw new Error('https://data.moenv.gov.tw?api_key=test-secret'); }) as typeof fetch);
assert.equal(error.status, 'error'); assert.equal(error.error?.includes('test-secret'), false);
const invalidJson = await fetchMoenvAirQuality('test-secret', (async () => new Response(']')) as typeof fetch);
assert.equal(invalidJson.status, 'error');
const points = Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, name: 'Test-only fixture', lat: 25.03, lng: 121.56, properties: { amenityType: i ? 'clinic' : 'park', coordinateMethod: 'node' } }));
const body = { source: 'https://download.geofabrik.de/asia/taiwan.html', sourceUpdatedAt: recent, points };
assert.equal(validateStaticImport(body).points.length, 10);
assert.throws(() => validateStaticImport({ ...body, points: [] }));
assert.throws(() => validateStaticImport({ ...body, sourceUpdatedAt: old }));
assert.throws(() => validateStaticImport({ ...body, points: [...points.slice(1), points[1]] }));
assert.throws(() => validateStaticImport({ ...body, points: points.map(p => ({ ...p, lat: 0 })) }));
assert.equal(staticPointsToPois([{ ...points[0], fetchedAt: recent }])[0].category, 'C4');
assert.equal(poiIdentity({ id: 'osm_way_123' }), poiIdentity({ id: 'w123', source: 'OpenStreetMap / Geofabrik' }));
assert.equal(withinStaticCoverage(25.03, 121.56), true);
assert.equal(withinStaticCoverage(24.95, 121.45), false, 'edge queries still need independent coverage');
console.log('Source fallback tests passed: freshness, missing keys, invalid payloads, preservation, static bounds and deduplication.');
