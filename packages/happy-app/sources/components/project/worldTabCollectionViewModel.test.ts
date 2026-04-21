import { describe, expect, it } from "vitest";
import { deriveWorldTabCollectionScreenState } from "./worldTabCollectionViewModel";

describe("deriveWorldTabCollectionScreenState", () => {
    it("returns loading when the first fetch is still in flight", () => {
        expect(
            deriveWorldTabCollectionScreenState({
                loading: true,
                error: null,
                totalCount: 0,
            }),
        ).toEqual({
            screenKind: "loading",
            requestState: {
                kind: "loading",
                error: null,
                hasData: false,
            },
        });
    });

    it("returns error when the blocking fetch failed and no data exists", () => {
        expect(
            deriveWorldTabCollectionScreenState({
                loading: false,
                error: "boom",
                totalCount: 0,
            }),
        ).toEqual({
            screenKind: "error",
            requestState: {
                kind: "error",
                error: "boom",
                hasData: false,
            },
        });
    });

    it("returns empty when loaded data has no visible rows", () => {
        expect(
            deriveWorldTabCollectionScreenState({
                loading: false,
                error: null,
                totalCount: 5,
                visibleCount: 0,
            }),
        ).toEqual({
            screenKind: "empty",
            requestState: {
                kind: "ready",
                error: null,
                hasData: true,
            },
        });
    });

    it("stays ready when stale data exists after a refresh error", () => {
        expect(
            deriveWorldTabCollectionScreenState({
                loading: false,
                error: "boom",
                totalCount: 2,
                visibleCount: 2,
            }),
        ).toEqual({
            screenKind: "ready",
            requestState: {
                kind: "ready",
                error: "boom",
                hasData: true,
            },
        });
    });
});
