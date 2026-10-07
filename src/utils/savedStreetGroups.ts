import type { SavedLocation } from '../types';
import { distanceMeters, streetIdentity, STREET_ANCHOR_RADIUS_METERS } from './streetBaseline';

export function validSavedCoordinates(record: SavedLocation): boolean {
  const { lat, lng } = record.coords || {};
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Display groups only. Fixed oldest anchors prevent chains of nearby visits
 * from swallowing a long road; original visits and evidence are untouched. */
export function groupSavedStreets(saved: SavedLocation[]): SavedLocation[][] {
  const groups: SavedLocation[][] = [];
  const ordered = [...saved].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || a.id.localeCompare(b.id));
  for (const record of ordered) {
    const meta = record.assessmentSnapshot?.baseline;
    const identity = streetIdentity(record.city, record.district, record.streetName);
    const namedRoad = /街|路|巷|弄|\b(street|road|avenue|lane|alley)\b/i.test(record.streetName);
    const group = validSavedCoordinates(record) && groups.find(visits => {
      const anchor = visits[0];
      if (!validSavedCoordinates(anchor)) return false;
      const known = visits.find(visit => visit.assessmentSnapshot?.baseline)?.assessmentSnapshot?.baseline;
      if (meta && known) return meta.segmentId === known.segmentId;
      const sameCoordinate = record.coords.lat.toFixed(5) === anchor.coords.lat.toFixed(5)
        && record.coords.lng.toFixed(5) === anchor.coords.lng.toFixed(5);
      if (sameCoordinate) return true; // Legacy reverse-geocoding aliases.
      return namedRoad && identity === streetIdentity(anchor.city, anchor.district, anchor.streetName)
        && distanceMeters(record.coords, known?.anchor || anchor.coords) <= STREET_ANCHOR_RADIUS_METERS;
    });
    if (group) group.push(record); else groups.push([record]);
  }
  return groups.map(visits => visits.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id)));
}
