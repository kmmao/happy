interface CacheEntry<V> {
    data: V;
    accessTime: number;
}

/**
 * A bounded, access-ordered (LRU) string-keyed cache.
 *
 * Owns the three behaviors the decrypted-data caches previously repeated per
 * entity: touch `accessTime` on every read, evict the least-recently-accessed
 * entry once `set` pushes size past the limit, and delete by key prefix. Values
 * may be `null`/falsy — a cached entry is distinguished from a miss by the entry
 * object's presence, not the value's truthiness (so `undefined` uniquely means
 * "not cached").
 */
export class LruCache<V> {
    private readonly map = new Map<string, CacheEntry<V>>();

    /** `now` is injectable so recency/eviction ordering is deterministically testable. */
    constructor(private readonly maxSize: number, private readonly now: () => number = Date.now) {}

    /** Read a value, refreshing its recency. `undefined` = not cached. */
    get(key: string): V | undefined {
        const entry = this.map.get(key);
        if (!entry) {
            return undefined;
        }
        entry.accessTime = this.now();
        return entry.data;
    }

    /** Write a value and evict the oldest entry if now over the limit. */
    set(key: string, data: V): void {
        this.map.set(key, { data, accessTime: this.now() });
        this.evictOldest();
    }

    /** Delete every entry whose key starts with `prefix`. */
    deletePrefix(prefix: string): void {
        for (const key of this.map.keys()) {
            if (key.startsWith(prefix)) {
                this.map.delete(key);
            }
        }
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }

    private evictOldest(): void {
        if (this.map.size <= this.maxSize) {
            return;
        }
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [key, entry] of this.map.entries()) {
            if (entry.accessTime < oldestTime) {
                oldestTime = entry.accessTime;
                oldestKey = key;
            }
        }
        if (oldestKey !== null) {
            this.map.delete(oldestKey);
        }
    }
}
