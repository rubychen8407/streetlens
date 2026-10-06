type Query = (sql: string, values: any[]) => Promise<{ rows: any[] }>;

export function decodeHistoryCursor(input: unknown): { timestamp: string; id: string } | null {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || input.length > 1024) throw new Error('Invalid history cursor');
  try {
    const value = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
    if (!/^-?\d{1,16}$/.test(value.timestamp) || !Number.isSafeInteger(Number(value.timestamp))
      || typeof value.id !== 'string' || !value.id || value.id.length > 200) throw Error();
    return value;
  } catch { throw new Error('Invalid history cursor'); }
}

/** Keyset pagination remains stable for equal timestamps and concurrent inserts.
 * Historical reports stay in PostgreSQL; only their large snapshot is omitted. */
export async function readHistoryPage(query: Query, workspaceId: string, limitInput: unknown, cursorInput: unknown) {
  const cursor = decodeHistoryCursor(cursorInput);
  const n = Number(limitInput);
  const limit = Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(100, Math.floor(n))) : 20;
  const result = await query(`SELECT id, session_timestamp AS "timestamp",
      payload - 'assessmentSnapshot' AS payload
    FROM assessment_sessions WHERE workspace_id = $1
      AND ($3::bigint IS NULL OR (session_timestamp, id) < ($3::bigint, $4::text))
    ORDER BY session_timestamp DESC, id DESC LIMIT $2`,
    [workspaceId, limit + 1, cursor?.timestamp ?? null, cursor?.id ?? null]);
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor = result.rows.length > limit && last
    ? Buffer.from(JSON.stringify({ timestamp: String(last.timestamp), id: last.id })).toString('base64url') : null;
  return { rows, nextCursor };
}
