import type { LocationCoord, SavedLocation } from '../types';
import { createSavedStreet } from './savedLocations';

export interface WalkFix extends LocationCoord { accuracy: number; timestamp: number }
export type WalkFeeling = NonNullable<SavedLocation['walkMoment']>['feeling'];
export const MAX_FIX_AGE_MS = 20_000;
export const MAX_ACCURACY_METERS = 50;
export const MAX_CONFIRMATION_DISTANCE_METERS = 35;

export function distanceMeters(a: LocationCoord, b: LocationCoord): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function usableFix(fix: WalkFix | null, now = Date.now()): fix is WalkFix {
  return !!fix && [fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite)
    && Math.abs(fix.lat) <= 90 && Math.abs(fix.lng) <= 180
    && fix.accuracy >= 0 && fix.accuracy <= MAX_ACCURACY_METERS
    && now - fix.timestamp >= -1000 && now - fix.timestamp <= MAX_FIX_AGE_MS;
}

export function canRecordWalk(fix: WalkFix | null, confirmed: WalkFix | null, now = Date.now()): boolean {
  return usableFix(fix, now) && !!confirmed
    && distanceMeters(fix, confirmed) <= MAX_CONFIRMATION_DISTANCE_METERS;
}

export function createWalkMoment(
  fix: WalkFix, confirmed: WalkFix | null, confirmedAt: number, feeling: WalkFeeling,
  address: { streetName: string; district: string; city: string }, source: 'walk' | 'shortcut', now = Date.now(),
): SavedLocation {
  if (!canRecordWalk(fix, confirmed, now)) throw new Error('請重新確認目前位置。');
  return { ...createSavedStreet({ ...address, coords: { lat: fix.lat, lng: fix.lng } }),
    timestamp: now, walkMoment: { feeling, accuracyMeters: fix.accuracy,
      positionTimestamp: fix.timestamp, confirmedAt, source } };
}

// Links open a mode only. A URL, refresh or location callback never writes a feeling.
export function isWalkShortcut(search: string): boolean {
  return new URLSearchParams(search).get('mode') === 'walk';
}

export function walkShortcutUrl(href: string): string {
  const url = new URL(href);
  url.search = ''; url.hash = ''; url.searchParams.set('mode', 'walk');
  return url.toString();
}

export function normalizeWalkMoment(value: unknown): SavedLocation['walkMoment'] {
  if (value == null) return undefined;
  const item = value as NonNullable<SavedLocation['walkMoment']>;
  if (!['good', 'bad', 'photo'].includes(item.feeling)
    || !['walk', 'shortcut'].includes(item.source)
    || !Number.isFinite(item.accuracyMeters) || item.accuracyMeters < 0 || item.accuracyMeters > MAX_ACCURACY_METERS
    || !Number.isFinite(item.positionTimestamp) || !Number.isFinite(item.confirmedAt)) {
    throw new Error('Invalid walk moment');
  }
  return { feeling: item.feeling, accuracyMeters: item.accuracyMeters,
    positionTimestamp: item.positionTimestamp, confirmedAt: item.confirmedAt, source: item.source };
}
