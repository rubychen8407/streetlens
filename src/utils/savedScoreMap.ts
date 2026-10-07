import type { SavedLocation } from '../types';
import { groupSavedStreets, validSavedCoordinates } from './savedStreetGroups';

/** Display only real completed scores. A newer pending visit must not hide an
 * older completed visit; grouping never changes the underlying history. */
export function savedScoreLocations(records: SavedLocation[]): SavedLocation[] {
  return groupSavedStreets(records).flatMap(visits => {
    const record = visits.find(visit => validSavedCoordinates(visit)
      && typeof visit.clsScore === 'number' && Number.isFinite(visit.clsScore)
      && visit.clsScore >= 0 && visit.clsScore <= 100 && Number.isFinite(visit.timestamp));
    return record ? [record] : [];
  }).sort((a,b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export function visibleSavedScores(records: SavedLocation[], bounds: { south: number; north: number; west: number; east: number }, limit = 200) {
  return records.filter(record => record.coords.lat >= bounds.south && record.coords.lat <= bounds.north
    && record.coords.lng >= bounds.west && record.coords.lng <= bounds.east).slice(0, limit);
}
