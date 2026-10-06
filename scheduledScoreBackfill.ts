import type { Pool } from 'pg';
import { backfillSavedScore, type AssessmentReadResult } from './savedScoreBackfill';
import type { SavedLocation } from './src/types';

type Loader = (location: { lat: number; lng: number; streetName: string; district: string; city: string }) => Promise<AssessmentReadResult>;

export async function backfillPendingPage(db: Pick<Pool, 'query' | 'connect'>, load: Loader, after = '') {
  const result = await db.query(
    `SELECT id, workspace_id, payload FROM assessment_sessions
     WHERE adjusted_cls IS NULL AND id > $1 ORDER BY id LIMIT 20`, [after],
  );
  let filled = 0, pending = 0, errors = 0;
  for (const row of result.rows) {
    const saved = row.payload as SavedLocation;
    try {
      // Loader reads persisted source snapshots and registers missing targets.
      const assessment = await load({ ...saved.coords, streetName: saved.streetName, district: saved.district, city: saved.city });
      if (assessment.status !== 200 || assessment.body?.scores?.overall == null) {
        if (assessment.status >= 400) errors++; else pending++;
        continue;
      }
      const updated = await backfillSavedScore(db, row.workspace_id, row.id, assessment.body);
      if (updated?.clsScore != null) filled++; else pending++;
    } catch { errors++; }
  }
  return { scanned: result.rows.length, filled, pending, errors,
    nextCursor: result.rows.length === 20 ? String(result.rows.at(-1).id) : null };
}
