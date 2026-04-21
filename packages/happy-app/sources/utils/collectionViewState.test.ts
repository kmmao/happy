import { describe, expect, it } from "vitest";
import { deriveCollectionViewState } from "./collectionViewState";

describe("deriveCollectionViewState", () => {
    it("treats the initial empty fetch as loading", () => {
        expect(
            deriveCollectionViewState({
                loading: true,
                error: null,
                count: 0,
            }),
        ).toEqual({
            kind: "loading",
            error: null,
            hasData: false,
        });
    });

    it("returns a blocking error only when no data was recovered", () => {
        expect(
            deriveCollectionViewState({
                loading: false,
                error: "boom",
                count: 0,
            }),
        ).toEqual({
            kind: "error",
            error: "boom",
            hasData: false,
        });
    });

    it("keeps stale data visible when a refresh fails", () => {
        expect(
            deriveCollectionViewState({
                loading: false,
                error: "boom",
                count: 2,
            }),
        ).toEqual({
            kind: "ready",
            error: "boom",
            hasData: true,
        });
    });

    it("normalizes blank errors so empty stays empty", () => {
        expect(
            deriveCollectionViewState({
                loading: false,
                error: "   ",
                count: 0,
            }),
        ).toEqual({
            kind: "empty",
            error: null,
            hasData: false,
        });
    });
});
