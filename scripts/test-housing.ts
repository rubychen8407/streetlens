import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { HOUSING_SCHEMA, importHousing, invalidateHousingCache, parseResidentialRow, readHousing, rocDate } from '../housingStore';
import { housingStreet, parseHousingFilters } from '../src/utils/housing';
import { registerHousingImport, registerHousingReads } from '../housingRoutes';
import { registerPrivateHousingAuth } from '../privateHousingAuth';

const city = '臺北市';
// Isolated source-shaped fixture; never used by runtime or published as source data.
const row = { '鄉鎮市區': '大安區', '主要用途': '住家用', '交易標的': '房地(土地+建物)+車位',
  '土地位置建物門牌': '臺北市大安區永康街１２號三樓', '交易年月日': '1150102', '建物型態': '華廈(10層含以下有電梯)',
  '總價元': '12000000', '建物移轉總面積平方公尺': '132.2314', '車位移轉總面積平方公尺': '33.05785',
  '車位總價元': '2000000', '建物現況格局-房': '3', '交易筆棟數': '土地1建物1車位1', '建築完成年月': '0950102',
  '移轉層次': '三層', '總樓層數': '九層', '電梯': '有', '備註': '', '編號': 'fixture-one' };
const parsed = parseResidentialRow(row, city)!;
assert.equal(parsed.areaPing, 30); assert.equal(parsed.unitTwdPing, 10000000 / 30);
assert.equal(parsed.totalTwd, 12000000); assert.equal(parsed.floor, 3); assert.equal(parsed.elevator, true);
assert.equal(parseResidentialRow({ ...row, '主要用途': '住商用' }, city), null);
for (const usage of ['辦公室', '商業用', '店舖', '', '住工用']) assert.equal(parseResidentialRow({ ...row, '主要用途': usage }, city), null);
for (const type of ['辦公商業大樓', '店面', '工廠', '其他']) assert.equal(parseResidentialRow({ ...row, '建物型態': type }, city), null);
assert.equal(parseResidentialRow({ ...row, '交易標的': '車位' }, city), null);
assert.equal(parseResidentialRow({ ...row, '車位總價元': '0' }, city)?.unitTwdPing, null, 'no invented parking split');
assert.equal(parseResidentialRow({ ...row, '電梯': '' }, city)?.elevator, null);
assert.equal(rocDate('1150230'), null); assert.equal(rocDate('1130229'), '2024-02-29');
assert.equal(housingStreet('台北市大安區忠孝東路四段123巷2號', city, '大安區'), '忠孝東路4段');
assert.equal(housingStreet('永康街口', city, '大安區'), '永康街');
const filters = parseHousingFilters({ city, district: '大安區', street: '永康街', years: '3' });
for (const bad of [{ years: '2' }, { minPrice: '3000', maxPrice: '1000' }, { elevator: 'yes' }, { rooms: '1.5' }, { street: '未知' }, { minPrice: "0 OR 1=1" }])
  assert.throws(() => parseHousingFilters({ city, district: '大安區', street: '永康街', ...bad }));

const pg = new PGlite(); await pg.exec(HOUSING_SCHEMA);
let queries = 0;
const query = async (sql: string, values?: any[]) => { queries++; return pg.query(sql, values); };
const db = { query, connect: async () => ({ query, release() {} }) } as any;
const source = { city, datasetKey: 'current', publishedOn: '2026-10-01', sourceUrl: 'https://plvr.land.moi.gov.tw/DownloadOpenData?type=zip&fileName=lvr_landcsv.zip' };
const original = await importHousing(db, { ...source, rows: [row, row, { ...row, '編號': 'fixture-special', '備註': '親友交易', '總價元': '9000000' },
  { ...row, '編號': 'fixture-office', '主要用途': '辦公室' }, { ...row, '編號': 'fixture-other-section', '土地位置建物門牌': '臺北市大安區信義路二段12號' }] });
assert.equal(original.rows, 3, 'duplicates are idempotent and commercial properties are not stored');
invalidateHousingCache(); const result = await readHousing(db, filters);
assert.equal(result.stats.count, 1); assert.equal(result.stats.averageTotalTwd, 12000000);
assert.equal(result.stats.averageUnitTwdPing, 10000000 / 30); assert.equal(result.records[0].notes, '');
const beforeHit = queries; assert.equal(await readHousing(db, filters), result); assert.equal(queries, beforeHit);
assert.equal((await readHousing(db, { ...filters, includeSpecial: true })).stats.count, 2);
assert.equal((await readHousing(db, { ...filters, maxPrice: 1000 })).stats.count, 0);
assert.equal((await readHousing(db, { ...filters, elevator: false })).stats.count, 0);
assert.equal((await readHousing(db, { ...filters, maxArea: 31, parking: true, rooms: 3 })).stats.count, 1);
assert.equal((await readHousing(db, { ...filters, street: '信義路一段' })).stats.count, 0, 'different section is never mixed');
for (const column of ['鄉鎮市區', '交易標的', '主要用途', '交易年月日', '建物型態', '建物移轉總面積平方公尺', '總價元', '編號', '土地位置建物門牌']) {
  const broken: Record<string, string> = { ...row }; delete broken[column];
  const beforeRejected = queries;
  await assert.rejects(importHousing(db, { ...source, publishedOn: '2026-10-11', rows: [broken] }), /schema changed/);
  assert.equal(queries, beforeRejected, 'schema failure is rejected before DB acquisition');
  assert.equal((await readHousing(db, filters)).stats.count, 1, 'schema failure cannot hide cached existing transaction');
}
assert.equal((await pg.query<{eligible: boolean}>("SELECT eligible FROM housing_transactions WHERE id='fixture-one'")).rows[0].eligible, true);
assert.equal((await importHousing(db, { ...source, rows: [row] })).skipped, false);
assert.equal((await importHousing(db, { ...source, rows: [row] })).skipped, true);
await assert.rejects(importHousing(db, { ...source, sourceUrl: 'http://169.254.169.254/', rows: [row] }));
await assert.rejects(importHousing(db, { ...source, publishedOn: '2026-02-30', rows: [row] }));
await assert.rejects(importHousing(db, { ...source, rows: [row, { ...row, '總價元': '1' }] }));
await importHousing(db, { ...source, publishedOn: '2026-10-11', rows: [{ ...row, '主要用途': '辦公室' },
  { ...row, '編號': 'fixture-special', '備註': '親友交易', '總價元': '9000000' }] });
assert.equal((await readHousing(db, filters)).stats.count, 0, 'corrected commercial row is no longer eligible');
await assert.rejects(importHousing(db, { ...source, rows: [row] }), /Older release rejected/);
await importHousing(db, { ...source, publishedOn: '2026-10-21', rows: [{ ...row, '主要用途': '辦公室' }] });
assert.equal((await readHousing(db, filters)).stats.count, 0, 'an all-commercial valid release cannot keep a corrected residential transaction eligible');
const stored = await pg.query<{count: number}>('SELECT count(*)::int AS count FROM housing_transactions');
assert.equal(stored.rows[0].count, 3, 'correction preserves rows without deleting history');

const app = express(); process.env.STREETLENS_REFRESH_TOKEN = 'isolated-test-token';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'fixture-client'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'fixture-secret';
process.env.STREETLENS_OWNER_EMAIL = 'fixture-owner@gmail.com'; process.env.STREETLENS_PUBLIC_ORIGIN = 'https://fixture.example';
registerPrivateHousingAuth(app, (async (url: any) => new Response(JSON.stringify(String(url).includes('/token')
  ? { access_token: 'fixture-access', token_type: 'Bearer' } : { sub: 'fixture-sub', email: 'fixture-owner@gmail.com', email_verified: true }),
  { headers: { 'Content-Type': 'application/json' } })) as typeof fetch);
registerHousingImport(app, db, () => Promise.resolve()); registerHousingReads(app, db, Promise.resolve());
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const port = (server.address() as any).port, base = 'http://127.0.0.1:' + port;
try {
  const beforeUnauthorized = queries;
  assert.equal((await fetch(base + '/api/internal/import-housing', { method: 'POST', body: 'bad', headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal(queries, beforeUnauthorized);
  assert.equal((await fetch(base + '/api/housing?city=臺北市&district=大安區&street=永康街')).status, 401);
  assert.equal(queries, beforeUnauthorized, 'private read rejects before DB access');
  const login = await fetch(base + '/api/private/google/login', { redirect: 'manual' });
  const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
  const callback = await fetch(base + '/api/private/google/callback?code=fixture-code&state=' + state,
    { redirect: 'manual', headers: { Cookie: login.headers.getSetCookie()[0].split(';')[0] } });
  const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-streetlens-private='))!.split(';')[0];
  assert.equal((await fetch(base + '/api/housing?city=臺北市&district=大安區&street=永康街&years=2', { headers: { Cookie: sessionCookie } })).status, 400);
  const response = await fetch(base + '/api/housing?city=臺北市&district=大安區&street=永康街', { headers: { Cookie: sessionCookie } });
  assert.equal(response.status, 200); assert.ok(JSON.stringify(await response.json()).length < 5000);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pg.close(); }
console.log('Residential housing passed: official usage/type exclusion, parking split, dates, exact street sections, SQL stats/filters, metadata coverage, caching, atomic corrections, authentication and bounded responses.');
