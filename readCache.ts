/** Process-local, bounded, single-flight cache. No synthetic data or error caching. */
export class ReadCache {
  private entries = new Map<string, { expires: number; promise: Promise<any> }>();
  constructor(private ttlMs: number, private maxEntries = 128, private now = Date.now) {}

  get<T>(key: string, loader: () => Promise<T>, cacheable: (value: T) => boolean = () => true): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) return existing.promise;
    this.entries.delete(key);
    const entry = { expires: Infinity, promise: undefined as unknown as Promise<T> };
    entry.promise = Promise.resolve().then(loader).then(value => {
      if (this.entries.get(key) === entry) {
        if (cacheable(value)) entry.expires = this.now() + this.ttlMs;
        else this.entries.delete(key);
      }
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return entry.promise;
  }

  clear() { this.entries.clear(); }
  delete(key: string) { this.entries.delete(key); }
}

export const referenceReadCache = new ReadCache(5 * 60_000, 256);
export const spatialReferenceCache = new ReadCache(5 * 60_000, 256);
export const assessmentReadCache = new ReadCache(60_000, 128);
export function invalidateSourceReads() {
  referenceReadCache.clear();
  spatialReferenceCache.clear();
  assessmentReadCache.clear();
}
