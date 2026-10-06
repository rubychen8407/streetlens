import type { SavedLocation } from '../types';

/** Display only real completed scores. A newer pending visit must not hide an
 * older completed visit; grouping never changes the underlying history. */
export function savedScoreLocations(records: SavedLocation[]): SavedLocation[] {
  const places = new Map<string, SavedLocation>();
  for (const record of records) {
    const { lat, lng } = record.coords || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
      || typeof record.clsScore !== 'number' || !Number.isFinite(record.clsScore)
      || record.clsScore < 0 || record.clsScore > 100 || !Number.isFinite(record.timestamp)) continue;
    const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const previous = places.get(key);
    if (!previous || record.timestamp > previous.timestamp
      || (record.timestamp === previous.timestamp && record.id > previous.id)) places.set(key, record);
  }
  return [...places.values()].sort((a,b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export function visibleSavedScores(records: SavedLocation[], bounds: { south: number; north: number; west: number; east: number }, limit = 200) {
  return records.filter(record => record.coords.lat >= bounds.south && record.coords.lat <= bounds.north
    && record.coords.lng >= bounds.west && record.coords.lng <= bounds.east).slice(0, limit);
}
