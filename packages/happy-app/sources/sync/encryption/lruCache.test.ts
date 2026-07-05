import { describe, it, expect } from "vitest";
import { LruCache } from "./lruCache";

/** A controllable clock so recency/eviction ordering is deterministic. */
function fakeClock(start = 0) {
    let t = start;
    return { now: () => t, tick: (by = 1) => { t += by; } };
}

describe("LruCache", () => {
    it("round-trips a value and returns undefined for a miss", () => {
        const c = new LruCache<number>(10);
        expect(c.get("a")).toBeUndefined();
        c.set("a", 1);
        expect(c.get("a")).toBe(1);
    });

    it("distinguishes a cached null/falsy value from a miss", () => {
        const c = new LruCache<number | null>(10);
        c.set("k", null);
        expect(c.get("k")).toBeNull(); // cached
        expect(c.get("missing")).toBeUndefined(); // not cached
    });

    it("evicts the least-recently-accessed entry when over the limit", () => {
        const clock = fakeClock();
        const c = new LruCache<string>(2, clock.now);
        clock.tick(); c.set("a", "A");
        clock.tick(); c.set("b", "B");
        // touch "a" so "b" becomes the least-recently-used
        clock.tick(); expect(c.get("a")).toBe("A");
        clock.tick(); c.set("c", "C"); // over limit → evict LRU ("b")
        expect(c.size).toBe(2);
        expect(c.get("b")).toBeUndefined();
        expect(c.get("a")).toBe("A");
        expect(c.get("c")).toBe("C");
    });

    it("deletePrefix removes only matching keys", () => {
        const c = new LruCache<number>(10);
        c.set("m1:1", 1);
        c.set("m1:2", 2);
        c.set("m2:1", 3);
        c.deletePrefix("m1:");
        expect(c.get("m1:1")).toBeUndefined();
        expect(c.get("m1:2")).toBeUndefined();
        expect(c.get("m2:1")).toBe(3);
        expect(c.size).toBe(1);
    });

    it("clear() empties the cache", () => {
        const c = new LruCache<number>(10);
        c.set("a", 1);
        c.set("b", 2);
        expect(c.size).toBe(2);
        c.clear();
        expect(c.size).toBe(0);
        expect(c.get("a")).toBeUndefined();
    });
});
