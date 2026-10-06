import type { SavedLocation } from '../types';

export function sameFieldPlace(a: SavedLocation, b: SavedLocation): boolean {
  const radians = Math.PI / 180;
  const h = Math.sin((a.coords.lat - b.coords.lat) * radians / 2) ** 2
    + Math.cos(a.coords.lat * radians) * Math.cos(b.coords.lat * radians)
    * Math.sin((a.coords.lng - b.coords.lng) * radians / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  if (distance <= 2) return true;
  return distance <= 35 && a.streetName.trim() === b.streetName.trim()
    && a.district === b.district && a.city === b.city;
}

/** Merge one user's field edit; omitted fields and previously captured evidence survive. */
export function mergeFieldRecord(previous: SavedLocation, incoming: SavedLocation): SavedLocation {
  const newest = (incoming.fieldUpdatedAt ?? incoming.timestamp) >= (previous.fieldUpdatedAt ?? previous.timestamp);
  const first = newest ? previous : incoming, last = newest ? incoming : previous;
  const defined = Object.fromEntries(Object.entries(last).filter(([, value]) => value !== undefined));
  const evidence = new Map((first.evidence || []).map(item => [item.id, item]));
  for (const item of last.evidence || []) {
    const definedItem = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
    evidence.set(item.id, { ...evidence.get(item.id), ...definedItem,
      storageKey: item.storageKey ?? evidence.get(item.id)?.storageKey } as typeof item);
  }
  const score = last.clsScore == null && first.clsScore != null ? first : last;
  const result = { ...first, ...defined, id: previous.id, coords: previous.coords,
    timestamp: previous.timestamp, evidence: [...evidence.values()],
    observationRatings: { ...first.observationRatings, ...last.observationRatings },
    fieldRecord: true,
    fieldUpdatedAt: Math.max(incoming.fieldUpdatedAt ?? incoming.timestamp, previous.fieldUpdatedAt ?? previous.timestamp),
  } as SavedLocation;
  // A photo changes evidence, rather than erasing a previously selected feeling.
  if (last.walkMoment?.feeling === 'photo' && first.walkMoment && first.walkMoment.feeling !== 'photo') {
    result.walkMoment = { ...last.walkMoment, feeling: first.walkMoment.feeling };
  }
  for (const key of ['clsScore', 'baselineClsScore', 'fieldAdjustment', 'fieldAdjustmentDetails',
    'grade', 'scores', 'assessmentSnapshot', 'scoreUpdatedAt', 'c1Data', 'c2Data', 'c3Data', 'c4Data', 'c5Data', 'weights'] as const) {
    (result as any)[key] = score[key];
  }
  return result;
}

export function upsertFieldRecord(current: SavedLocation[], incoming: SavedLocation): SavedLocation[] {
  const existing = current.find(item => sameFieldPlace(item, incoming));
  if (!existing) return [{ ...incoming, fieldRecord: true, fieldUpdatedAt: incoming.timestamp }, ...current];
  const updated = mergeFieldRecord(existing, { ...incoming,
    fieldUpdatedAt: Math.max(incoming.timestamp, (existing.fieldUpdatedAt ?? existing.timestamp) + 1) });
  updated.syncStatus = 'local';
  return current.map(item => item.id === existing.id ? updated : item);
}
