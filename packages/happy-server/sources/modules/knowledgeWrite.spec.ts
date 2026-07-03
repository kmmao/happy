import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMock, supersedeMock, embedMock } = vi.hoisted(() => ({
    createMock: vi.fn(),
    supersedeMock: vi.fn(),
    embedMock: vi.fn(),
}));

vi.mock("@/storage/inTx", () => ({
    // Run the callback with a fake tx exposing only projectKnowledge.create.
    inTx: (fn: (tx: unknown) => unknown) => fn({ projectKnowledge: { create: createMock } }),
}));
vi.mock("./knowledgeRelation", () => ({ supersedeEntry: supersedeMock }));
vi.mock("./knowledgeEmbedding", () => ({ storeKnowledgeEmbedding: embedMock }));

import { writeKnowledgeEntry } from "./knowledgeWrite";

const baseData = {
    projectId: "p1",
    entryType: "discovery",
    contributorType: "session",
    action: "create",
    title: "T",
    content: "C",
    tags: "[]",
    confidence: "medium",
    sessionId: "s1",
    affectedFiles: "[]",
    supersedesId: null,
} as const;

describe("writeKnowledgeEntry", () => {
    beforeEach(() => {
        createMock.mockReset().mockResolvedValue({ id: "k1", title: "T", content: "C" });
        supersedeMock.mockReset();
        embedMock.mockReset();
    });

    it("add: passes caller data through, no supersede, embeds stored row", async () => {
        const row = await writeKnowledgeEntry({ type: "add" }, { ...baseData });

        const passed = createMock.mock.calls[0][0].data;
        expect(passed.action).toBe("create"); // caller's create-case action preserved
        expect(passed.supersedesId).toBeNull();
        expect(supersedeMock).not.toHaveBeenCalled();
        expect(embedMock).toHaveBeenCalledWith("k1", "T", "C");
        expect(row).toEqual({ id: "k1", title: "T", content: "C" });
    });

    it("update: forces action=supersede + supersedesId, flips superseded entry in-tx", async () => {
        await writeKnowledgeEntry(
            { type: "update", existingId: "old" },
            { ...baseData, action: "create", supersedesId: null },
        );

        const passed = createMock.mock.calls[0][0].data;
        expect(passed.action).toBe("supersede"); // overridden regardless of caller create-case value
        expect(passed.supersedesId).toBe("old");
        expect(supersedeMock).toHaveBeenCalledWith(
            expect.anything(), // tx
            "k1", // new row id
            "old", // superseded id
        );
        expect(embedMock).toHaveBeenCalledWith("k1", "T", "C");
    });
});
