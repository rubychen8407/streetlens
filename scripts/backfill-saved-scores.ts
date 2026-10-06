const base = process.env.STREETLENS_REFRESH_URL || process.env.STREETLENS_BASE_URL;
const token = process.env.STREETLENS_REFRESH_TOKEN;
if (!base || !token) throw new Error('Refresh URL and token are required');
const endpoint = new URL('/api/internal/backfill-saved-scores', base);
let cursor = '', failed = false;
const totals = { scanned: 0, filled: 0, pending: 0, errors: 0 };
do {
  endpoint.searchParams.set('after', cursor);
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Saved score backfill returned HTTP ${response.status}`);
  const result = await response.json();
  for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(result[key] || 0);
  failed ||= result.errors > 0;
  const next = result.nextCursor || '';
  if (next && next <= cursor) throw new Error('Backfill cursor did not advance');
  cursor = next;
} while (cursor);
console.log(JSON.stringify(totals));
if (failed) process.exitCode = 1;
