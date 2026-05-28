import { describe, expect, it, vi } from "vitest";
import { supersedeEntry } from "./knowledgeRelation";
import { type Tx } from "@/storage/inTx";

describe("supersedeEntry", () => {
    function fakeTx() {
        const update = vi.fn(async () => ({}));
        const create = vi.fn(async () => ({}));
        const tx = {
            projectKnowledge: { update },
            knowledgeRelation: { create },
        } as unknown as Tx;
        return { tx, update, create };
    }

    it("flips the superseded entry to status superseded", async () => {
        const { tx, update } = fakeTx();
        await supersedeEntry(tx, "new-1", "old-1");
        expect(update).toHaveBeenCalledWith({
            where: { id: "old-1" },
            data: { status: "superseded" },
        });
    });

    it("records a refines relation from the new entry to the superseded one", async () => {
        const { tx, create } = fakeTx();
        await supersedeEntry(tx, "new-1", "old-1");
        expect(create).toHaveBeenCalledWith({
            data: {
                fromEntryId: "new-1",
                toEntryId: "old-1",
                relationType: "refines",
                metadata: null,
            },
        });
    });

    it("performs both writes on the same transaction client", async () => {
        const { tx, update, create } = fakeTx();
        await supersedeEntry(tx, "new-1", "old-1");
        expect(update).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(1);
    });
});
