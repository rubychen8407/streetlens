import type { FieldObservationAdjustment, LocationCoord, SavedLocation, StreetAssessmentResponse } from '../types';

export const SAVED_LOCATIONS_KEY = 'cls_saved_locations';
export const FAVORITES_KEY = 'cls_favorite_locations';

export function favoriteKey(coord: LocationCoord, name: string): string {
  return `${coord.lat.toFixed(5)}:${coord.lng.toFixed(5)}:${name.trim().toLowerCase()}`;
}

export function sameLocation(a: LocationCoord, b: LocationCoord): boolean {
  return Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
}

export function gradeForScore(score: number | null): SavedLocation['grade'] {
  return score == null ? null : score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
}

export function createSavedStreet(location: {
  coords: LocationCoord; streetName: string; district: string; city: string;
}, snapshot?: StreetAssessmentResponse | null): SavedLocation {
  const valid = snapshot && sameLocation(location.coords, snapshot.location) ? snapshot : undefined;
  const score = valid?.scores.overall ?? null;
  return {
    ...location, id: 'saved_' + crypto.randomUUID(), name: location.streetName,
    clsScore: score, baselineClsScore: score, grade: gradeForScore(score),
    scores: {
      c1: valid?.scores.c1.score ?? null, c2: valid?.scores.c2.score ?? null,
      c3: valid?.scores.c3.score ?? null, c4: valid?.scores.c4.score ?? null,
      c5: valid?.scores.c5.score ?? null,
    },
    assessmentSnapshot: valid, observationRatings: {}, evidence: [],
    timestamp: Date.now(), syncStatus: 'local',
  };
}

// A one-time fill of missing scores, never a rewrite of a scored historical visit.
// Both the baseline and adjustment must come from the backend.
export function fillSavedScore(
  saved: SavedLocation, snapshot: StreetAssessmentResponse, adjustment: FieldObservationAdjustment,
): SavedLocation {
  const baseline = snapshot?.scores?.overall;
  if (saved.clsScore != null || !sameLocation(saved.coords, snapshot.location)
    || baseline == null || !Number.isFinite(baseline) || baseline < 0 || baseline > 100
    || adjustment.baselineCls !== baseline || adjustment.adjustedCls == null
    || !Number.isFinite(adjustment.adjustedCls)) return saved;
  const factor = (id: string) => snapshot.factors.find(item => item.indicator === id)?.value ?? null;
  return {
    ...saved, clsScore: adjustment.adjustedCls, baselineClsScore: baseline,
    fieldAdjustment: adjustment.adjustment,
    fieldAdjustmentDetails: {
      categoryAdjustments: adjustment.categoryAdjustments,
      itemAdjustments: adjustment.itemAdjustments, ratedItemCount: adjustment.ratedItemCount,
    },
    assessmentSnapshot: snapshot, grade: gradeForScore(adjustment.adjustedCls),
    scores: { c1: snapshot.scores.c1.score, c2: snapshot.scores.c2.score,
      c3: snapshot.scores.c3.score, c4: snapshot.scores.c4.score, c5: snapshot.scores.c5.score },
    c1Data: saved.c1Data && { ...saved.c1Data, accidentRate: factor('trafficAccidentCount500m'), score: snapshot.scores.c1.score },
    c2Data: saved.c2Data && { ...saved.c2Data, supermarketDist: factor('supermarketDist'), convenienceDist: factor('convenienceDist'), clinicDist: factor('clinicDist'), schoolDist: factor('schoolDist'), bankPostDist: factor('bankPostDist'), poiDensityCount: factor('poiDensityCount'), score: snapshot.scores.c2.score },
    c3Data: saved.c3Data && { ...saved.c3Data, mrtOrRailDist: factor('mrtOrRailDist'), busStopDist: factor('busStopDist'), score: snapshot.scores.c3.score },
    c4Data: saved.c4Data && { ...saved.c4Data, airQualityScore: factor('airQualityScore'), score: snapshot.scores.c4.score },
    c5Data: saved.c5Data && { ...saved.c5Data, activityFrequency: factor('communityCulturalPoiCount800m'), score: snapshot.scores.c5.score },
    scoreUpdatedAt: snapshot.generatedAt,
  };
}

export function mergeSavedRecords(local: SavedLocation, remote: SavedLocation): SavedLocation {
  const photos = new Map((local.evidence || []).map(item => [item.id, item]));
  // A late remote response must not erase a completed local backfill.
  const chosen = local.clsScore != null && remote.clsScore == null ? local : remote;
  return { ...chosen, syncStatus: 'synced', scoreSyncPending: local.clsScore != null && remote.clsScore == null, evidence: (remote.evidence || []).map(item => ({
    ...item, storageKey: photos.get(item.id)?.storageKey,
  })) };
}

export function migrateFavoriteKeys(saved: SavedLocation[], keys: string[]): SavedLocation[] {
  const known = new Set(saved.map(item => favoriteKey(item.coords, item.streetName)));
  const missing: SavedLocation[] = [];
  for (const key of keys) {
    if (known.has(key)) continue;
    const [latText, lngText, ...nameParts] = key.split(':');
    const lat = Number(latText), lng = Number(lngText), streetName = nameParts.join(':');
    if (!latText || !lngText || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !streetName) continue;
    missing.push(createSavedStreet({ coords: { lat, lng }, streetName, district: '', city: '' }));
    known.add(key);
  }
  return [...missing, ...saved];
}
