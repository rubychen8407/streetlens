/** Deterministic capped backoff; focus/reconnect does not bypass cooldown. */
export class ReadRetry {
  private states = new Map<string, { attempts: number; nextAt: number }>();
  constructor(private now = Date.now) {}
  due(key: string) { return (this.states.get(key)?.nextAt || 0) <= this.now(); }
  defer(key: string) {
    const attempts = Math.min(6, (this.states.get(key)?.attempts || 0) + 1);
    this.states.set(key, { attempts, nextAt: this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1)) });
    while (this.states.size > 256) this.states.delete(this.states.keys().next().value!);
  }
  reset(key: string) { this.states.delete(key); }
}
