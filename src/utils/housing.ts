export const HOUSING_TYPES = ['公寓', '華廈', '住宅大樓', '透天厝', '套房'] as const;
export type HousingType = typeof HOUSING_TYPES[number];
export interface HousingRecord {
  id: string; city: string; district: string; street: string; address: string;
  tradedOn: string; totalTwd: number; areaPing: number;
  unitTwdPing: number | null; rooms: number | null; ageYears: number | null;
  floor: number | null; floors: number | null; buildingType: HousingType;
  elevator: boolean | null; parking: boolean; special: boolean;
  parkingSeparated: boolean; notes: string;
}
export interface HousingFilters {
  city: string; district: string; street: string; years: number;
  minPrice?: number; maxPrice?: number; minArea?: number; maxArea?: number;
  rooms?: number; maxAge?: number; minFloor?: number; maxFloor?: number;
  buildingType?: HousingType; elevator?: boolean; parking?: boolean;
  includeSpecial: boolean; page: number;
}
export interface HousingResult {
  status: 'available' | 'not_imported';
  scope: { city: string; district: string; street: string; years: number };
  coverage: { importedAt: string | null; oldestTransaction: string | null; newestTransaction: string | null };
  stats: { count: number; averageTotalTwd: number | null; medianTotalTwd: number | null;
    averageUnitTwdPing: number | null; unitSampleCount: number };
  latest: HousingRecord | null; records: HousingRecord[]; hasMore: boolean;
}
export function normalizeHousingText(value: string): string {
  return value.normalize('NFKC').replace(/台/g, '臺').replace(/\s+/g, '').trim();
}
/** Exact road + section, including numbered roads. Lanes remain on the same road.
 * No coordinates are inferred from an address. District is a separate required key. */
export function housingStreet(address: string, city: string, district: string): string | null {
  let clean = normalizeHousingText(address);
  for (const prefix of [normalizeHousingText(city), normalizeHousingText(district)])
    if (prefix && clean.startsWith(prefix)) clean = clean.slice(prefix.length);
  const road = clean.match(/^(.+?(?:大道|路|街)(?:[一二三四五六七八九十百\d]+段)?)/)?.[1];
  if (!road || road.length > 80) return null;
  const digit: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return road.replace(/([一二三四五六七八九十]+)段$/, (whole, n: string) => {
    const parts = n.split('十');
    const value = parts.length === 2 ? (parts[0] ? digit[parts[0]] : 1) * 10 + (parts[1] ? digit[parts[1]] : 0) : digit[n];
    return Number.isFinite(value) ? value + '段' : whole;
  });
}
export function parseHousingFilters(query: Record<string, unknown>): HousingFilters {
  const text = (key: string) => {
    const v = query[key];
    if (v == null) return '';
    if (typeof v !== 'string' || v.length > 100) throw new Error('Invalid ' + key);
    return normalizeHousingText(v);
  };
  const numeric = (key: string, max: number, integer = false): number | undefined => {
    const raw = query[key]; if (raw == null || raw === '') return undefined;
    if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Invalid ' + key);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) throw new Error('Invalid ' + key);
    return n;
  };
  const boolean = (key: string) => {
    const value = query[key]; if (value == null || value === '') return undefined;
    if (value !== 'true' && value !== 'false') throw new Error('Invalid ' + key);
    return value === 'true';
  };
  const city = text('city'), district = text('district');
  const street = housingStreet(text('street'), city, district);
  if (!city || !district || !street) throw new Error('City, district and named road are required');
  const years = numeric('years', 5, true) ?? 3;
  if (![1, 3, 5].includes(years)) throw new Error('Years must be 1, 3 or 5');
  const buildingType = text('buildingType') || undefined;
  if (buildingType && !HOUSING_TYPES.includes(buildingType as HousingType)) throw new Error('Invalid building type');
  const filters: HousingFilters = { city, district, street, years, buildingType: buildingType as HousingType | undefined,
    minPrice: numeric('minPrice', 1e6), maxPrice: numeric('maxPrice', 1e6),
    minArea: numeric('minArea', 1e4), maxArea: numeric('maxArea', 1e4), rooms: numeric('rooms', 20, true),
    maxAge: numeric('maxAge', 200), minFloor: numeric('minFloor', 100, true), maxFloor: numeric('maxFloor', 100, true),
    elevator: boolean('elevator'), parking: boolean('parking'), includeSpecial: boolean('includeSpecial') ?? false,
    page: numeric('page', 500, true) ?? 0 };
  for (const [min, max] of [[filters.minPrice, filters.maxPrice], [filters.minArea, filters.maxArea], [filters.minFloor, filters.maxFloor]])
    if (min != null && max != null && min > max) throw new Error('Minimum exceeds maximum');
  return filters;
}
