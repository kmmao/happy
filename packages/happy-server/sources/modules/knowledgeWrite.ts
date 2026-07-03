import { Prisma, ProjectKnowledge } from "@prisma/client";
import { inTx } from "@/storage/inTx";
import { supersedeEntry } from "./knowledgeRelation";
import { storeKnowledgeEmbedding } from "./knowledgeEmbedding";
import { ConsolidateResult } from "./knowledgeConsolidate";

/** consolidate() outcomes that actually write a row (the `noop` case is guarded by the caller). */
export type KnowledgeWriteAction = Exclude<ConsolidateResult, { type: "noop" }>;

/**
 * The single owner of the Knowledge create→supersede→embed spine.
 *
 * Given a `consolidate` decision plus the caller's base create data, this:
 *  1. Applies the supersede mapping when the decision is an update — forces
 *     `action: "supersede"` and `supersedesId: existingId` so the stored row
 *     records that it replaces the matched entry.
 *  2. Creates the ProjectKnowledge row and, for an update, flips the superseded
 *     entry to `status: "superseded"` + links it via `supersedeEntry` — both
 *     inside ONE transaction, so the create and the supersede commit atomically.
 *  3. Fires the embedding for semantic search (fire-and-forget).
 *
 * Callers keep ownership of their own create-data field shape (structured JSON,
 * contributorType, create-case action/supersedesId) and their downstream effects
 * (LLM refine, relatedIds relations, inbox items, world-event ephemerals). Those
 * legitimately differ per intake path (REST vs session socket vs Auto-Dream
 * transcript); only the invariant-bearing spine lives here.
 */
export async function writeKnowledgeEntry(
    action: KnowledgeWriteAction,
    createData: Prisma.ProjectKnowledgeUncheckedCreateInput,
): Promise<ProjectKnowledge> {
    const data: Prisma.ProjectKnowledgeUncheckedCreateInput =
        action.type === "update"
            ? { ...createData, action: "supersede", supersedesId: action.existingId }
            : createData;

    const created = await inTx(async (tx) => {
        const row = await tx.projectKnowledge.create({ data });
        if (action.type === "update") {
            await supersedeEntry(tx, row.id, action.existingId);
        }
        return row;
    });

    // Fire-and-forget: embedding of the row as actually stored.
    void storeKnowledgeEmbedding(created.id, created.title, created.content);
    return created;
}
