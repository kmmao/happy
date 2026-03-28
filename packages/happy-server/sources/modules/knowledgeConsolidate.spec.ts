import { describe, it, expect } from "vitest";
import {
    calculateSimilarity,
    determineAction,
    type ConsolidateInput,
    type ConsolidateCandidate,
} from "./knowledgeConsolidate";

describe("knowledgeConsolidate", () => {
    describe("calculateSimilarity", () => {
        it("should return 1.0 for identical titles and tags", () => {
            const score = calculateSimilarity(
                { titleWords: new Set(["fix", "auth", "bug"]), tags: new Set(["auth", "security"]) },
                { titleWords: new Set(["fix", "auth", "bug"]), tags: new Set(["auth", "security"]) },
            );
            expect(score).toBe(1.0);
        });

        it("should return 0 for completely different titles and no tags", () => {
            const score = calculateSimilarity(
                { titleWords: new Set(["fix", "auth"]), tags: new Set([]) },
                { titleWords: new Set(["add", "cache"]), tags: new Set([]) },
            );
            expect(score).toBe(0);
        });

        it("should weight title overlap at 60% and tag overlap at 40%", () => {
            // Title: 1/2 overlap = 0.5, Tags: 1/1 overlap = 1.0
            // Expected: 0.5 * 0.6 + 1.0 * 0.4 = 0.7
            const score = calculateSimilarity(
                { titleWords: new Set(["fix", "auth"]), tags: new Set(["auth"]) },
                { titleWords: new Set(["fix", "cache"]), tags: new Set(["auth"]) },
            );
            expect(score).toBeCloseTo(0.7);
        });

        it("should use title-only when both sides have empty tags", () => {
            const score = calculateSimilarity(
                { titleWords: new Set(["fix", "auth"]), tags: new Set([]) },
                { titleWords: new Set(["fix", "auth"]), tags: new Set([]) },
            );
            // Tags ignored → pure title overlap = 2/2 = 1.0
            expect(score).toBeCloseTo(1.0);
        });

        it("should use title-only when one side has empty tags", () => {
            const score = calculateSimilarity(
                { titleWords: new Set(["fix"]), tags: new Set(["auth"]) },
                { titleWords: new Set(["fix"]), tags: new Set([]) },
            );
            // Tags ignored (one side empty) → pure title overlap = 1/1 = 1.0
            expect(score).toBeCloseTo(1.0);
        });

        it("should be case-insensitive (pre-lowercased sets expected)", () => {
            const score = calculateSimilarity(
                { titleWords: new Set(["fix", "auth"]), tags: new Set(["security"]) },
                { titleWords: new Set(["fix", "auth"]), tags: new Set(["security"]) },
            );
            expect(score).toBe(1.0);
        });
    });

    describe("determineAction", () => {
        const baseInput: ConsolidateInput = {
            title: "Fix authentication bug",
            entryType: "fix",
            tags: ["auth", "security"],
            content: "Fixed the auth token refresh issue by updating the middleware.",
        };

        it("should return 'add' when no candidates exist", () => {
            const result = determineAction(baseInput, []);
            expect(result).toEqual({ type: "add" });
        });

        it("should return 'noop' when a very similar entry exists with shorter/equal content", () => {
            const candidates: ConsolidateCandidate[] = [{
                id: "existing-1",
                title: "Fix authentication bug",
                tags: ["auth", "security"],
                content: "Fixed the auth token refresh issue by updating the middleware. Also added retry logic.",
            }];

            const result = determineAction(baseInput, candidates);
            expect(result.type).toBe("noop");
            if (result.type === "noop") {
                expect(result.reason).toBeDefined();
            }
        });

        it("should return 'update' when similar entry exists but new content is 20%+ longer", () => {
            const candidates: ConsolidateCandidate[] = [{
                id: "existing-1",
                title: "Fix authentication bug",
                tags: ["auth", "security"],
                content: "Short fix.",
            }];

            const input: ConsolidateInput = {
                ...baseInput,
                content: "Fixed the auth token refresh issue by updating the middleware. This involved changes to three files and adding comprehensive error handling for edge cases.",
            };

            const result = determineAction(input, candidates);
            expect(result).toEqual({ type: "update", existingId: "existing-1" });
        });

        it("should return 'add' when similarity is below threshold (0.7)", () => {
            const candidates: ConsolidateCandidate[] = [{
                id: "existing-1",
                title: "Add caching layer for API responses",
                tags: ["cache", "performance"],
                content: "Added Redis caching for frequently accessed endpoints.",
            }];

            const result = determineAction(baseInput, candidates);
            expect(result).toEqual({ type: "add" });
        });

        it("should check all candidates and match the most similar one", () => {
            const candidates: ConsolidateCandidate[] = [
                {
                    id: "unrelated",
                    title: "Add new dashboard widget",
                    tags: ["ui", "dashboard"],
                    content: "New widget for monitoring.",
                },
                {
                    id: "similar",
                    title: "Fix authentication bug in middleware",
                    tags: ["auth", "security"],
                    content: "Short.",
                },
            ];

            const input: ConsolidateInput = {
                ...baseInput,
                content: "Fixed the auth token refresh issue by updating the middleware. Long detailed content here.",
            };

            const result = determineAction(input, candidates);
            expect(result).toEqual({ type: "update", existingId: "similar" });
        });

        it("should detect similarity even when both sides have no tags (title-only)", () => {
            const candidates: ConsolidateCandidate[] = [{
                id: "no-tags",
                title: "Fix authentication bug",
                tags: [],
                content: "Short fix.",
            }];

            const inputNoTags: ConsolidateInput = {
                ...baseInput,
                tags: [],
                content: "Fixed the auth token refresh issue by updating the middleware. Long detailed description of the fix.",
            };

            const result = determineAction(inputNoTags, candidates);
            // Title overlap = 1.0 (tags ignored) → similarity > 0.7, new content longer → update
            expect(result).toEqual({ type: "update", existingId: "no-tags" });
        });

        it("should pick the most similar candidate, not the first match", () => {
            const candidates: ConsolidateCandidate[] = [
                {
                    id: "partial-match",
                    title: "Fix authentication issue",
                    tags: ["auth"],
                    content: "Partial match content that is reasonably long.",
                },
                {
                    id: "best-match",
                    title: "Fix authentication bug",
                    tags: ["auth", "security"],
                    content: "Short.",
                },
            ];

            const input: ConsolidateInput = {
                ...baseInput,
                content: "Fixed the auth token refresh issue by updating the middleware. Very detailed content.",
            };

            const result = determineAction(input, candidates);
            // Both are > 0.7 but "best-match" has higher similarity → should pick it
            expect(result).toEqual({ type: "update", existingId: "best-match" });
        });
    });
});
