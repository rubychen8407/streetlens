import type { Pool } from 'pg';

// Decimal MB: leave 300 MB below the requested 1 GB project budget.
export const WRITE_LIMIT_BYTES = 700_000_000;
export const GUARDED_TABLES = [
  'assessment_sessions', 'assessment_evidence', 'assessment_targets',
  'external_data_snapshots', 'external_spatial_points', 'external_spatial_areas',
  'external_spatial_lines', 'flood_hazard_polygons', 'historical_flood_events',
] as const;

/** Install without changing or deleting any existing rows. Fail closed at startup. */
export async function ensureStorageBudget(db: Pool | null): Promise<void> {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE OR REPLACE FUNCTION streetlens_write_budget() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        -- Every writer holds this lock until commit/rollback, including bulk refreshes.
        PERFORM pg_advisory_xact_lock(739201, 1);
        IF pg_database_size(current_database()) >= ${WRITE_LIMIT_BYTES} THEN
          RAISE EXCEPTION 'STORAGE_WRITE_LIMIT: 資料庫已達 700 MB 寫入保護上限，既有資料保留，請稍後重試同步。'
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END;
      $$;
    `);
    for (const table of GUARDED_TABLES) {
      const exists = await client.query('SELECT to_regclass($1) AS relation', [table]);
      if (!exists.rows[0]?.relation) continue; // Optional PostGIS tables.
      for (const timing of ['BEFORE', 'AFTER']) {
        const name = `streetlens_budget_${timing.toLowerCase()}`;
        await client.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
        await client.query(`CREATE TRIGGER ${name} ${timing} INSERT OR UPDATE ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION streetlens_write_budget()`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
