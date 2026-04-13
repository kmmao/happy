import { describe, expect, it } from "vitest";
import { getSessionKnowledgeDisplayTimestamp } from "./sessionKnowledgeDisplayTimestamp";

describe("getSessionKnowledgeDisplayTimestamp", () => {
    it("uses createdAt for changes entries", () => {
        expect(
            getSessionKnowledgeDisplayTimestamp({
                activeTab: "changes",
                entry: {
                    createdAt: 100,
                },
            }),
        ).toBe(100);
    });

    it("uses accessedAt for references entries", () => {
        expect(
            getSessionKnowledgeDisplayTimestamp({
                activeTab: "references",
                entry: {
                    createdAt: 100,
                    accessedAt: 200,
                },
            }),
        ).toBe(200);
    });
});
