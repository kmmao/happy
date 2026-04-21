import { describe, expect, it } from "vitest";
import { resolveSharedCollectionState } from "./sharedCollectionState";

describe("resolveSharedCollectionState", () => {
    it("returns loading only when the first page is still empty", () => {
        expect(
            resolveSharedCollectionState({
                loading: true,
                error: null,
                count: 0,
            }),
        ).toBe("loading");
    });

    it("returns error only when loading is done and no data was recovered", () => {
        expect(
            resolveSharedCollectionState({
                loading: false,
                error: "boom",
                count: 0,
            }),
        ).toBe("error");
    });

    it("returns empty when the collection finished cleanly but has no rows", () => {
        expect(
            resolveSharedCollectionState({
                loading: false,
                error: null,
                count: 0,
            }),
        ).toBe("empty");
    });

    it("stays ready when rows already exist even if a refresh is in flight", () => {
        expect(
            resolveSharedCollectionState({
                loading: true,
                error: null,
                count: 3,
            }),
        ).toBe("ready");
    });

    it("stays ready when stale data exists alongside a non-fatal error", () => {
        expect(
            resolveSharedCollectionState({
                loading: false,
                error: "boom",
                count: 2,
            }),
        ).toBe("ready");
    });
});
