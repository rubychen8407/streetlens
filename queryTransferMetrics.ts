type Result = { rows: any[] };
type Aggregate = { queries: number; errors: number; rows: number; estimatedResultBytes: number; durationMs: number };

/** Logical JSON result bytes, NOT measured PostgreSQL wire/Neon billing bytes.
 * Fixed operation labels only: never log SQL, parameters, row contents or IDs. */
export class QueryTransferMetrics {
  private totals = new Map<string, Aggregate>();
  private lastFlush: number;
  constructor(private emit: (value: unknown) => void, private now = Date.now, private intervalMs = 60_000) {
    this.lastFlush = now();
  }
  async query<T extends Result>(label: string, loader: () => Promise<T>): Promise<T> {
    const started = this.now();
    let rows = 0, bytes = 0, failed = false;
    try {
      const result = await loader();
      rows = result.rows.length;
      try {
        bytes = Buffer.byteLength(JSON.stringify(result.rows,
          (_key, value) => typeof value === 'bigint' ? value.toString() : value));
      } catch { /* An unmeasurable result must still reach the caller. */ }
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // Record on completion: a timer flush during an in-flight query must not
      // orphan its row/byte counters in a previously flushed object.
      const total = this.totals.get(label) || { queries: 0, errors: 0, rows: 0, estimatedResultBytes: 0, durationMs: 0 };
      this.totals.set(label, total);
      total.queries++; total.errors += failed ? 1 : 0;
      total.rows += rows; total.estimatedResultBytes += bytes;
      total.durationMs += Math.max(0, this.now() - started);
      if (this.now() - this.lastFlush >= this.intervalMs) this.flush();
    }
  }
  flush() {
    if (!this.totals.size) return;
    // Clone before emitting so no later accumulation changes an emitted event.
    const operations = Object.fromEntries([...this.totals].map(([key, value]) => [key, { ...value }]));
    this.totals.clear(); this.lastFlush = this.now();
    try { this.emit({ event: 'db_transfer_metrics', byteMeasure: 'serialized_result_estimate', operations }); }
    catch { /* Observability must never break a successful DB read. */ }
  }
}

const observer = new QueryTransferMetrics(value => console.info(JSON.stringify(value)));
if (process.env.STREETLENS_DB_TRANSFER_METRICS === 'true') {
  // Flush even after traffic stops; this timer never queries/wakes the database.
  setInterval(() => observer.flush(), 60_000).unref();
}
export function measuredQuery<T extends Result>(label: string, loader: () => Promise<T>): Promise<T> {
  return process.env.STREETLENS_DB_TRANSFER_METRICS === 'true' ? observer.query(label, loader) : loader();
}
