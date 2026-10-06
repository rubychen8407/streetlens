import type { OfficialCitywideSourceResult } from './official';

export const MOENV_AQI_URL = 'https://data.moenv.gov.tw/api/v2/aqx_p_432';
export const STATIC_OSM_SOURCE = 'osm_static_taipei';
export const STATIC_MAX_AGE_MS = 30 * 86400_000;
export const AQI_MAX_AGE_MS = 24 * 3600_000;
export function isSourceFresh(timestamp: unknown, maxAgeMs: number, now = Date.now()): boolean {
  if (typeof timestamp !== 'string') return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now + 300_000 && now - time <= maxAgeMs;
}
function numeric(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '') || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export async function fetchMoenvAirQuality(key = process.env.MOENV_API_KEY, fetcher = fetch): Promise<OfficialCitywideSourceResult> {
  const retrievedAt = new Date().toISOString();
  const source = 'MOENV AQX_P_432 official air quality monitoring';
  if (!key) return { points: [], source, retrievedAt, status: 'error', error: 'MOENV_API_KEY is not configured' };
  try {
    const url = new URL(MOENV_AQI_URL);
    url.search = new URLSearchParams({ api_key: key, limit: '1000', format: 'json' }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`MOENV HTTP ${response.status}`);
    const body: any = await response.json();
    const rows = Array.isArray(body.records) ? body.records : Array.isArray(body) ? body : null;
    if (!rows) throw new Error('MOENV response has no records array');
    const points = rows.flatMap((row: any) => {
      const lat = numeric(row.latitude ?? row.Latitude), lng = numeric(row.longitude ?? row.Longitude);
      const aqi = numeric(row.aqi ?? row.AQI), pm25 = numeric(row['pm2.5'] ?? row['PM2.5']);
      const rawTime = String(row.publishtime ?? row.PublishTime ?? '');
      // MOENV naive timestamps are Taiwan local time, never server local time.
      const publishTime = /^\d{4}[-/]\d{2}[-/]\d{2} \d{2}:\d{2}(:\d{2})?$/.test(rawTime)
        ? rawTime.replaceAll('/', '-').replace(' ', 'T') + '+08:00' : rawTime;
      if (lat == null || lng == null || lat < 21 || lat > 26.5 || lng < 118 || lng > 123
        || aqi == null || aqi < 0 || !isSourceFresh(publishTime, AQI_MAX_AGE_MS)) return [];
      const id = String(row.siteid ?? row.SiteId ?? row.sitename ?? row.SiteName ?? '');
      if (!id) return [];
      return [{ id, name: String(row.sitename ?? row.SiteName ?? id), lat, lng,
        properties: { aqi, pm25, publishTime: new Date(publishTime).toISOString(), sourceType: 'station' } }];
    });
    if (!points.length) throw new Error('MOENV has no valid fresh station readings');
    return { points, source, retrievedAt, status: 'available',
      sourceUpdatedAt: points.map((point: any) => point.properties.publishTime).sort().at(-1) };
  } catch (error: any) {
    // Do not echo fetch exceptions: they can include the API key in the request URL.
    return { points: [], source, retrievedAt, status: 'error',
      error: /^MOENV /.test(error?.message || '') ? error.message : 'MOENV request or parsing failed' };
  }
}
export function shouldReplaceInventory(result: { status: string; points: unknown[]; lines?: unknown[]; areas?: unknown[] }): boolean {
  return result.status === 'available' && (result.points.length + (result.lines?.length || 0) + (result.areas?.length || 0)) > 0;
}

export function poiIdentity(poi: { id?: string; source?: string }): string | undefined {
  const legacy = poi.id?.match(/^osm_(node|way|relation)_(\d+)$/);
  if (legacy) return legacy[1][0] + legacy[2];
  if (poi.source?.includes('OpenStreetMap') && /^[nwr]\d+$/.test(poi.id || '')) return poi.id;
  return undefined;
}
export function withinStaticCoverage(lat: number, lng: number): boolean {
  // Keep a 1.5 km edge margin: queries near the extract boundary still use Overpass.
  return lat >= 24.965 && lat <= 25.205 && lng >= 121.465 && lng <= 121.655;
}
