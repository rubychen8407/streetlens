import type { SavedLocation } from '../types';

// Retained only to validate metadata on existing saved visits.
const MAX_ACCURACY_METERS = 50;

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

