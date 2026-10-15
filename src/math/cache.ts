import type { EffectiveValue, OllivierValue } from './types';

export type CacheEntries<T> = Array<[string, T[]]>;

/** Bound retained data by both entries and edge values, including a large single graph. */
export class ComponentCache<T> {
  private entries = new Map<string, T[]>();
  private valueCount = 0;
  constructor(initial: CacheEntries<T> = [], private limit = 4096, private entryLimit = 128) {
    for (const [key, values] of initial) this.set(key, values);
  }
  get(key: string): T[] | undefined {
    const values = this.entries.get(key);
    if (values) { this.entries.delete(key); this.entries.set(key, values); }
    return values;
  }
  set(key: string, values: T[]): void {
    const previous = this.entries.get(key);
    if (previous) { this.valueCount -= previous.length; this.entries.delete(key); }
    if (values.length > this.limit) return;
    this.entries.set(key, values);
    this.valueCount += values.length;
    while (this.valueCount > this.limit || this.entries.size > this.entryLimit) {
      const oldest = this.entries.keys().next().value!;
      this.valueCount -= this.entries.get(oldest)!.length;
      this.entries.delete(oldest);
    }
  }
  snapshot(): CacheEntries<T> { return [...this.entries]; }
}

export interface ComputationCacheSnapshot {
  ollivier: CacheEntries<OllivierValue>;
  effective: CacheEntries<EffectiveValue>;
}
