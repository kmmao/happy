import { describe, it, expect } from "vitest";
import { buildChain, type ChainEntry } from "./knowledgeChain";
import type { KnowledgeRelationRow } from "./knowledgeRelation";

describe("knowledgeChain", () => {
    describe("buildChain", () => {
        it("should return single entry with no relations when entry has no links", () => {
            const entries: ChainEntry[] = [{
                id: "a",
                entryType: "fix",
                action: "create",
                status: "active",
                title: "Fix auth",
                content: "Fixed auth",
                tags: "[]",
                confidence: "high",
                supersedesId: null,
                createdAt: new Date("2026-03-01"),
            }];

            const result = buildChain("a", entries);
            expect(result.chain).toHaveLength(1);
            expect(result.chain[0].id).toBe("a");
            expect(result.relations).toHaveLength(0);
        });

        it("should build a supersession chain (A supersedes B)", () => {
            const entries: ChainEntry[] = [
                {
                    id: "old",
                    entryType: "fix",
                    action: "create",
                    status: "superseded",
                    title: "Fix auth v1",
                    content: "First fix",
                    tags: "[]",
                    confidence: "medium",
                    supersedesId: null,
                    createdAt: new Date("2026-03-01"),
                },
                {
                    id: "new",
                    entryType: "fix",
                    action: "supersede",
                    status: "active",
                    title: "Fix auth v2",
                    content: "Better fix",
                    tags: "[]",
                    confidence: "high",
                    supersedesId: "old",
                    createdAt: new Date("2026-03-02"),
                },
            ];

            const result = buildChain("new", entries);
            expect(result.chain).toHaveLength(2);
            // Sorted by createdAt ascending
            expect(result.chain[0].id).toBe("old");
            expect(result.chain[1].id).toBe("new");
            expect(result.relations).toHaveLength(1);
            expect(result.relations[0]).toEqual({ from: "new", to: "old", type: "supersedes" });
        });

        it("should include related entries via graph relations", () => {
            const entries: ChainEntry[] = [
                {
                    id: "main",
                    entryType: "decision",
                    action: "create",
                    status: "active",
                    title: "Use Redis for caching",
                    content: "Decision",
                    tags: "[]",
                    confidence: "high",
                    supersedesId: null,
                    createdAt: new Date("2026-03-01"),
                },
                {
                    id: "related-1",
                    entryType: "discovery",
                    action: "create",
                    status: "active",
                    title: "Redis benchmark results",
                    content: "Benchmarks",
                    tags: "[]",
                    confidence: "medium",
                    supersedesId: null,
                    createdAt: new Date("2026-02-28"),
                },
            ];

            const graphRelations: KnowledgeRelationRow[] = [
                { id: "r1", fromEntryId: "main", toEntryId: "related-1", relationType: "related", metadata: null, createdAt: new Date("2026-03-01") },
            ];

            const result = buildChain("main", entries, graphRelations);
            expect(result.chain).toHaveLength(2);
            expect(result.relations).toContainEqual({ from: "main", to: "related-1", type: "related" });
        });

        it("should limit chain depth to prevent infinite loops", () => {
            // Create a 15-entry deep chain; max depth is 10
            const entries: ChainEntry[] = [];
            for (let i = 0; i < 15; i++) {
                entries.push({
                    id: `entry-${i}`,
                    entryType: "fix",
                    action: i === 0 ? "create" : "supersede",
                    status: i === 14 ? "active" : "superseded",
                    title: `Fix v${i}`,
                    content: `Fix version ${i}`,
                    tags: "[]",
                    confidence: "medium",
                    supersedesId: i > 0 ? `entry-${i - 1}` : null,
                    createdAt: new Date(`2026-03-${String(i + 1).padStart(2, "0")}`),
                });
            }

            const result = buildChain("entry-14", entries);
            // Should cap at MAX_CHAIN_DEPTH (10) entries
            expect(result.chain.length).toBeLessThanOrEqual(10);
        });

        it("should cap total entries even with wide fan-out", () => {
            // Root entry with 20 related entries (fan-out) via graph relations
            const childIds = Array.from({ length: 20 }, (_, i) => `child-${i}`);
            const entries: ChainEntry[] = [
                {
                    id: "root",
                    entryType: "decision",
                    action: "create",
                    status: "active",
                    title: "Root decision",
                    content: "Root",
                    tags: "[]",
                    confidence: "high",
                    supersedesId: null,
                    createdAt: new Date("2026-03-01"),
                },
                ...childIds.map((id, i) => ({
                    id,
                    entryType: "discovery",
                    action: "create",
                    status: "active" as const,
                    title: `Child ${i}`,
                    content: `Child content ${i}`,
                    tags: "[]",
                    confidence: "medium" as const,
                    supersedesId: null,
                    createdAt: new Date(`2026-03-${String(i + 2).padStart(2, "0")}`),
                })),
            ];

            const graphRelations: KnowledgeRelationRow[] = childIds.map((childId, i) => ({
                id: `r-${i}`,
                fromEntryId: "root",
                toEntryId: childId,
                relationType: "related" as const,
                metadata: null,
                createdAt: new Date("2026-03-01"),
            }));

            const result = buildChain("root", entries, graphRelations);
            // collected.size cap should limit total entries to MAX_CHAIN_DEPTH (10)
            expect(result.chain.length).toBeLessThanOrEqual(10);
        });
    });
});
