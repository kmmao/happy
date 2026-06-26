import { describe, it, expect } from "vitest";
import { rankKnowledgeByContextHints, type RankableKnowledgeEntry } from "./knowledgeRanking";

function entry(
    title: string,
    over: Partial<RankableKnowledgeEntry> = {},
): RankableKnowledgeEntry & { id: string } {
    return {
        id: title,
        title,
        tags: over.tags ?? "",
        content: over.content ?? "",
        createdAt: over.createdAt ?? new Date(0),
    };
}

describe("rankKnowledgeByContextHints", () => {
    it("ranks entries by how many distinct hints they match", () => {
        const entries = [
            entry("a", { content: "mentions redis only" }),
            entry("b", { content: "mentions redis and postgres" }),
            entry("c", { content: "unrelated" }),
        ];
        const ranked = rankKnowledgeByContextHints(entries, ["redis", "postgres"], 3);
        expect(ranked.map((e) => e.title)).toEqual(["b", "a", "c"]);
    });

    it("is case-insensitive on both hints and entry text", () => {
        // entry title "REDIS Setup" (upper) must match hint "redis" (lower) and
        // outrank a non-matching entry.
        const matching = entry("REDIS Setup");
        const other = entry("unrelated note");
        const ranked = rankKnowledgeByContextHints([other, matching], ["redis"], 1);
        expect(ranked).toHaveLength(1);
        expect(ranked[0].title).toBe("REDIS Setup");
    });

    it("counts presence, not frequency (a hint repeated in one entry scores 1)", () => {
        const repeated = entry("repeated", { content: "redis redis redis redis" });
        const twoHints = entry("two", { content: "redis postgres" });
        const ranked = rankKnowledgeByContextHints([repeated, twoHints], ["redis", "postgres"], 2);
        // 'two' matches 2 distinct hints → outranks 'repeated' (1 distinct hint).
        expect(ranked[0].title).toBe("two");
    });

    it("breaks score ties by recency (newer createdAt first)", () => {
        const older = entry("older", { content: "redis", createdAt: new Date(1000) });
        const newer = entry("newer", { content: "redis", createdAt: new Date(2000) });
        const ranked = rankKnowledgeByContextHints([older, newer], ["redis"], 2);
        expect(ranked.map((e) => e.title)).toEqual(["newer", "older"]);
    });

    it("matches across title, tags, and content", () => {
        const inTags = entry("t", { tags: "redis,cache" });
        const ranked = rankKnowledgeByContextHints([inTags], ["redis"], 1);
        expect(ranked).toHaveLength(1);
    });

    it("returns at most `limit` entries", () => {
        const entries = [entry("a", { content: "redis" }), entry("b", { content: "redis" }), entry("c", { content: "redis" })];
        expect(rankKnowledgeByContextHints(entries, ["redis"], 2)).toHaveLength(2);
    });
});
