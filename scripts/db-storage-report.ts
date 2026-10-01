import { dataDb } from '../db';

// Diagnostics only: no schema changes, deletes, VACUUM, or application payloads.
async function main() {
  if (!dataDb) throw new Error('Set DATABASE_URL to run the read-only storage report.');
  const client = await dataDb.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    const size = await client.query(`SELECT pg_database_size(current_database())::text AS database_bytes,
      pg_size_pretty(pg_database_size(current_database())) AS database_size`);
    const tables = await client.query(`SELECT schemaname, relname,
      pg_total_relation_size(relid)::text AS total_bytes,
      pg_table_size(relid)::text AS table_and_toast_bytes,
      pg_indexes_size(relid)::text AS index_bytes, n_live_tup AS estimated_rows,
      n_dead_tup AS estimated_dead_rows, last_autovacuum
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`);
    const exists = await client.query(`SELECT to_regclass('public.assessment_evidence') AS evidence,
      to_regclass('public.external_data_snapshots') AS snapshots,
      to_regclass('public.assessment_sessions') AS sessions`);
    const photos = exists.rows[0].evidence ? (await client.query(`SELECT count(*) FILTER (WHERE photo_data IS NOT NULL)::text AS photo_count,
      COALESCE(sum(photo_size_bytes), 0)::text AS original_photo_bytes,
      COALESCE(sum(pg_column_size(photo_data)), 0)::text AS stored_photo_bytes
      FROM assessment_evidence`)).rows : [];
    const sources = exists.rows[0].snapshots ? (await client.query(`SELECT source_key, count(*)::text AS scope_count,
      sum(pg_column_size(payload))::text AS payload_bytes,
      max(pg_column_size(payload))::text AS largest_payload_bytes
      FROM external_data_snapshots GROUP BY source_key ORDER BY sum(pg_column_size(payload)) DESC`)).rows : [];
    const sessions = exists.rows[0].sessions ? (await client.query(`SELECT count(*)::text AS session_count,
      COALESCE(sum(pg_column_size(payload)), 0)::text AS payload_bytes,
      count(*) FILTER (WHERE adjusted_cls IS NULL)::text AS pending_cls_count
      FROM assessment_sessions`)).rows : [];
    await client.query('COMMIT');
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), database: size.rows[0], tables: tables.rows, photos, sources, sessions,
      note: 'Column sizes exclude table/index overhead. Neon project branches and restore history are billed separately from this database measurement.' }, null, 2));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Storage report failed'); process.exitCode = 1; })
  .finally(async () => { await dataDb?.end(); });
