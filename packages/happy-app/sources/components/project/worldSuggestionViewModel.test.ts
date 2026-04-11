import { describe, expect, it } from "vitest";
import {
    getSuggestionTypeLabelKey,
    getSuggestionTypeConfig,
    applySuggestionStatusUpdate,
    removeSuggestionOptimistically,
    restoreSuggestionAtIndex,
    shouldRefetchSuggestions,
    mergeFetchedSuggestions,
    groupSuggestionsByBucket,
    type SuggestionLike,
} from "./worldSuggestionViewModel";
import type { SuggestionBucket, SuggestionStatus, SuggestionType } from "@/sync/apiWorld";

describe("getSuggestionTypeLabelKey", () => {
    it("returns decision label key for suggested_decision", () => {
        expect(getSuggestionTypeLabelKey("suggested_decision")).toBe("suggestions.typeDecision");
    });

    it("keeps runtime fallback for unexpected type input", () => {
        expect(getSuggestionTypeLabelKey("unknown_type" as unknown as SuggestionType)).toBe("suggestions.typeTask");
    });
});

describe("getSuggestionTypeConfig", () => {
    it("returns dedicated decision icon and color", () => {
        expect(getSuggestionTypeConfig("suggested_decision")).toEqual({
            icon: "help-circle-outline",
            color: "#F59E0B",
        });
    });
});

describe("applySuggestionStatusUpdate", () => {
    const suggestions: SuggestionLike[] = [
        { id: "sug-1" },
        { id: "sug-2" },
    ];

    it("removes processing suggestion", () => {
        expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "processing" })).toEqual([
            { id: "sug-2" },
        ]);
    });

    it("removes accepted suggestion", () => {
        expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "accepted" })).toEqual([
            { id: "sug-2" },
        ]);
    });

    it("removes dismissed suggestion", () => {
        expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "dismissed" })).toEqual([
            { id: "sug-2" },
        ]);
    });

    it("removes expired suggestion", () => {
        expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "expired" })).toEqual([
            { id: "sug-2" },
        ]);
    });

    it("keeps list unchanged for unrelated status", () => {
        expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "open" })).toEqual(suggestions);
    });
});

describe("shouldRefetchSuggestions", () => {
    it("returns true for open and suspended status", () => {
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "open" })).toBe(true);
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "suspended" })).toBe(true);
    });

    it("returns false for terminal statuses", () => {
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "processing" })).toBe(false);
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "accepted" })).toBe(false);
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "dismissed" })).toBe(false);
        expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "expired" })).toBe(false);
    });
});

describe("removeSuggestionOptimistically", () => {
    const suggestions: SuggestionLike[] = [
        { id: "sug-1" },
        { id: "sug-2" },
        { id: "sug-3" },
    ];

    it("removes suggestion and returns its original index", () => {
        expect(removeSuggestionOptimistically(suggestions, "sug-2")).toEqual({
            suggestions: [{ id: "sug-1" }, { id: "sug-3" }],
            removedIndex: 1,
        });
    });

    it("returns unchanged list when suggestion is missing", () => {
        expect(removeSuggestionOptimistically(suggestions, "missing")).toEqual({
            suggestions,
            removedIndex: -1,
        });
    });
});

describe("mergeFetchedSuggestions", () => {
    it("filters out pending removed suggestions from fetched list", () => {
        expect(mergeFetchedSuggestions([
            { id: "sug-1" },
            { id: "sug-2" },
            { id: "sug-3" },
        ], new Set(["sug-2"]))).toEqual([
            { id: "sug-1" },
            { id: "sug-3" },
        ]);
    });
});

describe("groupSuggestionsByBucket", () => {
    it("groups suggestions into three lanes", () => {
        const result = groupSuggestionsByBucket([
            { id: "s1", bucket: "next_step" as SuggestionBucket },
            { id: "s2", bucket: "needs_decision" as SuggestionBucket },
            { id: "s3", bucket: "needs_human_input" as SuggestionBucket },
            { id: "s4", bucket: "unknown" as unknown as SuggestionBucket },
        ]);

        expect(result.nextStep.map((item) => item.id)).toEqual(["s1", "s4"]);
        expect(result.needsDecision.map((item) => item.id)).toEqual(["s2"]);
        expect(result.needsHumanInput.map((item) => item.id)).toEqual(["s3"]);
    });
});

describe("restoreSuggestionAtIndex", () => {
    const suggestions: SuggestionLike[] = [
        { id: "sug-1" },
        { id: "sug-3" },
    ];

    it("restores suggestion at its original index", () => {
        expect(restoreSuggestionAtIndex(suggestions, { id: "sug-2" }, 1)).toEqual([
            { id: "sug-1" },
            { id: "sug-2" },
            { id: "sug-3" },
        ]);
    });

    it("appends when original index is out of range", () => {
        expect(restoreSuggestionAtIndex(suggestions, { id: "sug-4" }, 99)).toEqual([
            { id: "sug-1" },
            { id: "sug-3" },
            { id: "sug-4" },
        ]);
    });

    it("does not duplicate suggestion when already restored", () => {
        expect(restoreSuggestionAtIndex([
            { id: "sug-1" },
            { id: "sug-2" },
            { id: "sug-3" },
        ], { id: "sug-2" }, 1)).toEqual([
            { id: "sug-1" },
            { id: "sug-2" },
            { id: "sug-3" },
        ]);
    });
});

