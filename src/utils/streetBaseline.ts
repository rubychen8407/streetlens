import type { LocationCoord, SavedLocation, StreetAssessmentResponse } from '../types';

// Nearby portions of the same named road share one *observed* anchor, not a
// fabricated grid centre. Long roads remain separate (250 m anchor radius).
export const STREET_ANCHOR_RADIUS_METERS = 250;
export function streetIdentity(city: string, district: string, street: string): string {
  const clean = (s: string) => s.normalize('NFKC').replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase();
  const town = clean(city);
  let road = clean(street);
  for (const prefix of [town, clean(district)]) if (prefix && road.startsWith(prefix)) road = road.slice(prefix.length);
  return `${town}:${road}`;
}
export function distanceMeters(a: LocationCoord, b: LocationCoord): number {
  const r = Math.PI / 180;
  const h = Math.sin((a.lat - b.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r)
    * Math.sin((a.lng - b.lng) * r / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function matchesStreetBaseline(saved: SavedLocation, snapshot: StreetAssessmentResponse): boolean {
  const meta = snapshot.baseline;
  if (!meta) return false;
  return streetIdentity(saved.city, saved.district, saved.streetName) === meta.streetIdentity
    && distanceMeters(saved.coords, meta.anchor) <= STREET_ANCHOR_RADIUS_METERS;
}
export function savedAdjustmentPoints(saved: SavedLocation): number {
  if (Number.isFinite(saved.fieldAdjustment)) return saved.fieldAdjustment!;
  if (saved.clsScore != null && saved.baselineClsScore != null) return saved.clsScore - saved.baselineClsScore;
  return 0;
}
export function adjustedFromPoints(baseline: number | null, points: number): number | null {
  return baseline == null ? null : Math.min(100, Math.max(0, baseline + points));
}
/** Derived score cache only: never alter a visit's identity, notes, ratings or evidence. */
export function rebaseSavedStreet(saved: SavedLocation, snapshot: StreetAssessmentResponse): SavedLocation {
  if (!matchesStreetBaseline(saved, snapshot) || snapshot.scores.overall == null) return saved;
  if (saved.assessmentSnapshot?.baseline?.version === snapshot.baseline?.version) return saved;
  if (saved.assessmentSnapshot?.baseline && Date.parse(saved.scoreUpdatedAt || saved.assessmentSnapshot.generatedAt)
    > Date.parse(snapshot.generatedAt)) return saved; // Late reads cannot roll a newer shared baseline back.
  // Pending questionnaires must first go through the backend's bounded adjustment.
  if (saved.clsScore == null && saved.fieldAdjustment == null && Object.keys(saved.observationRatings || {}).length) return saved;
  const points = savedAdjustmentPoints(saved);
  const clsScore = adjustedFromPoints(snapshot.scores.overall, points)!;
  return { ...saved, baselineClsScore: snapshot.scores.overall, clsScore, fieldAdjustment: points,
    grade: clsScore >= 90 ? 'S' : clsScore >= 80 ? 'A' : clsScore >= 70 ? 'B' : clsScore >= 60 ? 'C' : 'D',
    scores: { c1: snapshot.scores.c1.score, c2: snapshot.scores.c2.score, c3: snapshot.scores.c3.score,
      c4: snapshot.scores.c4.score, c5: snapshot.scores.c5.score },
    assessmentSnapshot: { ...snapshot, location: { ...snapshot.location, ...saved.coords,
      city: saved.city, district: saved.district, streetName: saved.streetName } }, scoreUpdatedAt: snapshot.generatedAt };
}
