import { describe, expect, it } from "vitest";
import { createRequestGuard } from "./useLatestRequest";

describe("createRequestGuard — latest-request-wins", () => {
    it("treats a just-begun request as current", () => {
        const g = createRequestGuard();
        const token = g.begin();
        expect(g.isCurrent(token)).toBe(true);
    });

    it("supersedes an older request when a newer one begins", () => {
        const g = createRequestGuard();
        const first = g.begin();
        const second = g.begin();
        expect(g.isCurrent(first)).toBe(false); // stale — discard its response
        expect(g.isCurrent(second)).toBe(true);
    });

    it("invalidate() discards any in-flight request without starting a new one", () => {
        const g = createRequestGuard();
        const token = g.begin();
        g.invalidate(); // e.g. session re-key / reset / unmount
        expect(g.isCurrent(token)).toBe(false);
    });

    it("tokens are strictly monotonic across begin/invalidate", () => {
        const g = createRequestGuard();
        const a = g.begin();
        g.invalidate();
        const b = g.begin();
        expect(b).toBeGreaterThan(a);
        expect(g.isCurrent(a)).toBe(false);
        expect(g.isCurrent(b)).toBe(true);
    });
});
