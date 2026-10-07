import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { HOUSING_TYPES, housingStreet, normalizeHousingText, type HousingFilters, type HousingRecord, type HousingResult } from './src/utils/housing';

export const HOUSING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS housing_transactions (
    city TEXT NOT NULL, id TEXT NOT NULL, district TEXT NOT NULL, street TEXT NOT NULL, address TEXT NOT NULL,
    traded_on DATE NOT NULL, total_twd DOUBLE PRECISION NOT NULL, area_ping DOUBLE PRECISION NOT NULL,
    unit_twd_ping DOUBLE PRECISION, rooms INTEGER, age_years DOUBLE PRECISION, floor INTEGER, floors INTEGER,
    building_type TEXT NOT NULL, elevator BOOLEAN, parking BOOLEAN NOT NULL, special BOOLEAN NOT NULL,
    parking_separated BOOLEAN NOT NULL, notes TEXT NOT NULL, published_on DATE NOT NULL, eligible BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (city, id)
  );
  CREATE INDEX IF NOT EXISTS housing_street_date ON housing_transactions (city, district, street, traded_on DESC, id);
  CREATE TABLE IF NOT EXISTS housing_imports (
    city TEXT NOT NULL, dataset_key TEXT NOT NULL, content_hash TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_on DATE NOT NULL, row_count INTEGER NOT NULL, source_url TEXT NOT NULL, oldest_date DATE, newest_date DATE,
    PRIMARY KEY (city, dataset_key)
  );`;
export async function ensureHousingSchema(db: Pool | null) { if (db) await db.query(HOUSING_SCHEMA); }

function number(value: string): number | null {
  if (!value?.trim()) return null;
  const n = Number(value.replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : null;
}
export function rocDate(value: string): string | null {
  const clean = value?.trim(); if (!/^\d{7}$/.test(clean)) return null;
  const y = Number(clean.slice(0, 3)) + 1911, m = Number(clean.slice(3, 5)), d = Number(clean.slice(5, 7));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10) : null;
}
const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function housingFloor(value: string): number | null {
  const v = normalizeHousingText(value || '').replace(/層|樓/g, '');
  if (/^\d+$/.test(v)) return Number(v);
  if (!/^[一二三四五六七八九十]+$/.test(v)) return null; // Multi-floor / basement / whole building is unknown.
  if (v.includes('十')) { const [a, b] = v.split('十'); return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0); }
  return digits[v] ?? null;
}
/** Official CSV rows, not LLM or inferred property facts. */
export function parseResidentialRow(row: Record<string, string>, cityInput: string): HousingRecord | null {
  const city = normalizeHousingText(cityInput), district = normalizeHousingText(row['鄉鎮市區'] || '');
  const usage = normalizeHousingText(row['主要用途'] || '');
  if (!['住家用', '住宅', '住宅用'].includes(usage)) return null;
  if (!/^房地\(土地\+建物\)(?:\+車位)?$/.test(normalizeHousingText(row['交易標的'] || ''))) return null;
  const buildingType = HOUSING_TYPES.find(t => normalizeHousingText(row['建物型態'] || '').startsWith(t));
  const address = normalizeHousingText(row['土地位置建物門牌'] || row['土地區段位置建物區段門牌'] || '');
  const street = housingStreet(address, city, district), tradedOn = rocDate(row['交易年月日']);
  const totalTwd = number(row['總價元']), area = number(row['建物移轉總面積平方公尺']);
  const id = row['編號']?.trim();
  if (!district || !street || !id || !buildingType || !tradedOn || !totalTwd || !area) return null;
  const parking = /車位[1-9]/.test(normalizeHousingText(row['交易筆棟數'] || ''))
    || normalizeHousingText(row['交易標的']).endsWith('+車位');
  const parkingArea = number(row['車位移轉總面積平方公尺']), parkingPrice = number(row['車位總價元']);
  const separated = !parking || (parkingArea != null && parkingArea > 0 && parkingPrice != null && parkingPrice > 0
    && parkingArea < area && parkingPrice < totalTwd);
  const netArea = separated && parking ? area - parkingArea! : area;
  const netPrice = separated && parking ? totalTwd - parkingPrice! : totalTwd;
  const built = rocDate(row['建築完成年月']);
  const age = built ? (Date.parse(tradedOn) - Date.parse(built)) / 86400000 / 365.2425 : null;
  const roomsValue = number(row['建物現況格局-房']);
  const notes = (row['備註'] || '').trim().slice(0, 1000);
  return { id, city, district, street, address, tradedOn, totalTwd, areaPing: netArea / 3.305785,
    unitTwdPing: separated ? netPrice / (netArea / 3.305785) : null,
    rooms: roomsValue != null && Number.isInteger(roomsValue) ? roomsValue : null,
    ageYears: age != null && age >= 0 ? age : null,
    floor: housingFloor(row['移轉層次']), floors: housingFloor(row['總樓層數']), buildingType,
    elevator: row['電梯'] === '有' ? true : row['電梯'] === '無' ? false : null,
    parking, parkingSeparated: separated, special: /親友|特殊|急買|急賣|持分|部分移轉|地上權|債務|法院|未登記|增建/.test(notes), notes };
}
const cache = new Map<string, { expires: number; data: HousingResult }>();
export function invalidateHousingCache() { cache.clear(); }
const columns = `id, city, district, street, address, traded_on::text AS "tradedOn", total_twd AS "totalTwd",
  area_ping AS "areaPing", unit_twd_ping AS "unitTwdPing", rooms, age_years AS "ageYears", floor, floors,
  building_type AS "buildingType", elevator, parking, special, parking_separated AS "parkingSeparated", notes`;
export function housingWhere(filters: HousingFilters, asOf = new Date().toISOString().slice(0, 10)) {
  const values: unknown[] = [filters.city, filters.district, filters.street, asOf, filters.years];
  const clauses = ['eligible = TRUE', 'city=$1', 'district=$2', 'street=$3', "traded_on >= ($4::date - make_interval(years => $5::int))", 'traded_on <= $4::date'];
  const add = (column: string, operation: string, value: unknown) => { if (value == null) return; values.push(value); clauses.push(`${column} ${operation} $${values.length}`); };
  add('total_twd', '>=', filters.minPrice == null ? undefined : filters.minPrice * 10000);
  add('total_twd', '<=', filters.maxPrice == null ? undefined : filters.maxPrice * 10000);
  add('area_ping', '>=', filters.minArea); add('area_ping', '<=', filters.maxArea);
  add('rooms', '=', filters.rooms); add('age_years', '<=', filters.maxAge);
  add('floor', '>=', filters.minFloor); add('floor', '<=', filters.maxFloor);
  add('building_type', '=', filters.buildingType); add('elevator', '=', filters.elevator); add('parking', '=', filters.parking);
  if (!filters.includeSpecial) clauses.push('special = FALSE');
  return { sql: clauses.join(' AND '), values };
}
export async function readHousing(db: Pick<Pool, 'query'>, filters: HousingFilters): Promise<HousingResult> {
  const asOf = new Date().toISOString().slice(0, 10), key = asOf + JSON.stringify(filters);
  const hit = cache.get(key); if (hit && hit.expires > Date.now()) return hit.data;
  const { sql, values } = housingWhere(filters, asOf);
  const [stats, records, coverage, latest] = await Promise.all([
    db.query(`SELECT count(*)::int AS count, avg(total_twd) AS "averageTotalTwd",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY total_twd) AS "medianTotalTwd",
      avg(unit_twd_ping) AS "averageUnitTwdPing", count(unit_twd_ping)::int AS "unitSampleCount"
      FROM housing_transactions WHERE ${sql}`, values),
    db.query(`SELECT ${columns} FROM housing_transactions WHERE ${sql} ORDER BY traded_on DESC, id DESC LIMIT 21 OFFSET $${values.length + 1}`, [...values, filters.page * 20]),
    db.query(`SELECT max(imported_at)::text AS "importedAt", min(oldest_date)::text AS "oldestTransaction",
      max(newest_date)::text AS "newestTransaction" FROM housing_imports WHERE city=$1`, [filters.city]),
    db.query(`SELECT ${columns} FROM housing_transactions WHERE ${sql} ORDER BY traded_on DESC, id DESC LIMIT 1`, values),
  ]);
  const data: HousingResult = { status: coverage.rows[0]?.importedAt ? 'available' : 'not_imported',
    scope: { city: filters.city, district: filters.district, street: filters.street, years: filters.years },
    coverage: coverage.rows[0], stats: stats.rows[0], latest: latest.rows[0] ?? null,
    records: records.rows.slice(0, 20), hasMore: records.rows.length > 20 };
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { data, expires: Date.now() + 10 * 60 * 1000 }); return data;
}
export async function importHousing(db: Pool, input: any) {
  const city = normalizeHousingText(typeof input?.city === 'string' ? input.city : '');
  if (!['臺北市', '新北市'].includes(city)) throw new Error('Only Taipei and New Taipei are enabled');
  if (!/^(?:current|\d{3}S[1-4])$/.test(input.datasetKey || '')) throw new Error('Invalid dataset key');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.publishedOn || '') || !Number.isFinite(Date.parse(input.publishedOn)) || new Date(input.publishedOn).toISOString().slice(0,10) !== input.publishedOn) throw new Error('Invalid release date');
  const sourceUrl = new URL(input.sourceUrl);
  if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'plvr.land.moi.gov.tw'
    || !['/DownloadOpenData', '/DownloadSeason'].includes(sourceUrl.pathname)) throw new Error('Invalid official source URL');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 30000) throw new Error('Expected 1–30000 source rows');
  const rows = input.rows.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(v => typeof v !== 'string')) throw new Error('Expected official CSV string fields');
    return parseResidentialRow(row, city);
  }).filter((row: HousingRecord | null): row is HousingRecord => row != null);
  if (!rows.length && !input.rows.some((row: any) => row['編號'] && rocDate(row['交易年月日']) && row['主要用途']))
    throw new Error('No valid official transaction rows; previous import retained');
  const ids = new Map<string, HousingRecord>();
  for (const row of rows) {
    const previous = ids.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('Conflicting transaction ID');
    ids.set(row.id, row);
  }
  const records = [...ids.values()].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash('sha256').update(JSON.stringify(input.rows)).digest('hex');
  const client = await db.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(739201, 3)');
    const old = await client.query('SELECT content_hash, published_on::text FROM housing_imports WHERE city=$1 AND dataset_key=$2', [city, input.datasetKey]);
    if (old.rows[0]?.published_on > input.publishedOn) throw new Error('Older release rejected');
    if (old.rows[0]?.content_hash === hash) { await client.query('COMMIT'); return { skipped: true, rows: records.length }; }
    // Corrected non-residential rows become ineligible without deleting history.
    const accepted = new Set(records.map(row => row.id));
    const rejected = input.rows.map((row: any) => row['編號']?.trim()).filter((id: string) => id && !accepted.has(id));
    if (rejected.length) await client.query('UPDATE housing_transactions SET eligible=FALSE,published_on=$3::date WHERE city=$1 AND id=ANY($2::text[]) AND published_on <= $3::date', [city, rejected, input.publishedOn]);
    // One transaction per city/release; no partially visible bulk imports.
    for (let start = 0; start < records.length; start += 500) {
      const chunk = records.slice(start, start + 500);
      await client.query(`INSERT INTO housing_transactions
        (city,id,district,street,address,traded_on,total_twd,area_ping,unit_twd_ping,rooms,age_years,floor,floors,building_type,elevator,parking,special,parking_separated,notes,published_on)
        SELECT city,id,district,street,address,"tradedOn"::date,"totalTwd","areaPing","unitTwdPing",rooms,"ageYears",floor,floors,"buildingType",elevator,parking,special,"parkingSeparated",notes,$2::date
        FROM jsonb_to_recordset($1::jsonb) AS x(city text,id text,district text,street text,address text,"tradedOn" text,"totalTwd" float8,"areaPing" float8,"unitTwdPing" float8,rooms int,"ageYears" float8,floor int,floors int,"buildingType" text,elevator boolean,parking boolean,special boolean,"parkingSeparated" boolean,notes text)
        ON CONFLICT(city,id) DO UPDATE SET district=EXCLUDED.district,street=EXCLUDED.street,address=EXCLUDED.address,
          traded_on=EXCLUDED.traded_on,total_twd=EXCLUDED.total_twd,area_ping=EXCLUDED.area_ping,unit_twd_ping=EXCLUDED.unit_twd_ping,
          rooms=EXCLUDED.rooms,age_years=EXCLUDED.age_years,floor=EXCLUDED.floor,floors=EXCLUDED.floors,
          building_type=EXCLUDED.building_type,elevator=EXCLUDED.elevator,parking=EXCLUDED.parking,
          eligible=TRUE,special=EXCLUDED.special,parking_separated=EXCLUDED.parking_separated,notes=EXCLUDED.notes,published_on=EXCLUDED.published_on
        WHERE housing_transactions.published_on <= EXCLUDED.published_on`, [JSON.stringify(chunk), input.publishedOn]);
    }
    await client.query(`INSERT INTO housing_imports(city,dataset_key,content_hash,published_on,row_count,source_url,oldest_date,newest_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(city,dataset_key) DO UPDATE SET content_hash=EXCLUDED.content_hash,published_on=EXCLUDED.published_on,
      row_count=EXCLUDED.row_count,source_url=EXCLUDED.source_url,oldest_date=EXCLUDED.oldest_date,newest_date=EXCLUDED.newest_date,imported_at=NOW()`, [city, input.datasetKey, hash, input.publishedOn, records.length, sourceUrl.href, records.map(row => row.tradedOn).sort()[0], records.map(row => row.tradedOn).sort().at(-1)]);
    await client.query('COMMIT'); invalidateHousingCache(); return { skipped: false, rows: records.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
