import type { SavedLocation, StreetAssessmentResponse, FieldObservationAdjustment } from '../types';
import { fillSavedScore, mergeSavedRecords } from './savedLocations';

export async function resolveSavedScore(saved: SavedLocation, workspaceId: string, signal: AbortSignal, request = fetch): Promise<SavedLocation> {
  if (saved.clsScore != null && !saved.scoreSyncPending) return saved;
  if (saved.syncStatus !== 'local') {
    const remote = await request(`/api/assessments/${encodeURIComponent(saved.id)}/score?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'POST', signal });
    if (remote.status === 200) return mergeSavedRecords(saved, await remote.json());
    if (remote.status !== 404) return saved;
    // A legacy record that only exists in this browser can join the sync queue.
    saved = { ...saved, syncStatus: 'local' };
  }
  const params = new URLSearchParams({ lat: String(saved.coords.lat), lng: String(saved.coords.lng),
    streetName: saved.streetName, district: saved.district, city: saved.city });
  const response = await request('/api/assessment?' + params, { signal });
  if (response.status !== 200) return saved;
  const snapshot = await response.json() as StreetAssessmentResponse;
  if (snapshot?.scores?.overall == null) return saved;
  const adjusted = await request('/api/assessment/field-adjustment', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baselineCls: snapshot.scores.overall, ratings: saved.observationRatings || {} }),
  });
  if (!adjusted.ok) return saved;
  return fillSavedScore(saved, snapshot, await adjusted.json() as FieldObservationAdjustment);
}
