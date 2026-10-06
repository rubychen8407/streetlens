import type { Express } from 'express';
import type { Pool } from 'pg';
import { dataDb } from './db';
import { getAssessmentSession } from './assessmentDb';
import { applyFieldObservationAdjustment } from './scoring';
import { fillSavedScore } from './src/utils/savedLocations';
import { rebaseSavedStreet } from './src/utils/streetBaseline';
import type { SavedLocation, StreetAssessmentResponse } from './src/types';

export interface AssessmentReadResult { status: number; body: any }
type AssessmentLoader = (location: { lat: number; lng: number; streetName: string; district: string; city: string }) => Promise<AssessmentReadResult>;

export async function backfillSavedScore(
  pool: Pick<Pool, 'connect'>, workspaceId: string, id: string, snapshot: StreetAssessmentResponse,
): Promise<SavedLocation | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      'SELECT payload FROM assessment_sessions WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [id, workspaceId],
    );
    const original = rows.rows[0]?.payload as SavedLocation | undefined;
    if (!original) { await client.query('COMMIT'); return null; }
    const adjustment = applyFieldObservationAdjustment(snapshot.scores.overall, original.observationRatings || {});
    const rebased = rebaseSavedStreet(original, snapshot);
    const updated = rebased !== original ? rebased : fillSavedScore(original, snapshot, adjustment);
    if (updated !== original) {
      // Never call saveAssessmentSession here: it replaces evidence rows/photos.
      await client.query(
        `UPDATE assessment_sessions SET baseline_cls = $3, adjusted_cls = $4,
         payload = $5::jsonb, updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId, updated.baselineClsScore, updated.clsScore, JSON.stringify(updated)],
      );
    }
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function registerSavedScoreRoutes(app: Express, loadAssessment: AssessmentLoader, schemaReady: Promise<unknown>) {
  app.post('/api/assessments/:id/score', async (req, res) => {
    try {
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
      if (!workspaceId || workspaceId.length > 200) return res.status(400).json({ error: 'workspaceId is required' });
      if (!dataDb) return res.status(503).json({ error: 'Database unavailable' });
      await schemaReady;
      const saved = await getAssessmentSession(workspaceId, req.params.id);
      if (!saved) return res.status(404).json({ error: 'Saved street not found' });
      // Use the persisted coordinates and ratings; accept no client-supplied score.
      const result = await loadAssessment({ ...saved.coords, streetName: saved.streetName, district: saved.district, city: saved.city });
      if (result.status !== 200) return res.status(result.status).json(result.body);
      if (result.body.scores.overall == null) return res.status(202).json({ dataStatus: 'pending_refresh' });
      const updated = await backfillSavedScore(dataDb, workspaceId, saved.id, result.body);
      return updated ? res.json(updated) : res.status(404).json({ error: 'Saved street was deleted' });
    } catch (error) {
      console.error('Saved score backfill error:', error);
      return res.status(503).json({ error: 'Unable to update saved score' });
    }
  });
}
