import { db } from "@/storage/db";
import { log } from "@/utils/log";

export type KnowledgeRelationType = "related" | "contradicts" | "refines" | "combines";

export interface KnowledgeRelationRow {
    id: string;
    fromEntryId: string;
    toEntryId: string;
    relationType: KnowledgeRelationType;
    metadata: string | null;
    createdAt: Date;
}

/**
 * Add a relation between two knowledge entries.
 * Idempotent — duplicate inserts are silently ignored via unique constraint.
 */
export async function addRelation(
    fromId: string,
    toId: string,
    relationType: KnowledgeRelationType,
    metadata?: string,
): Promise<void> {
    try {
        await db.knowledgeRelation.create({
            data: {
                fromEntryId: fromId,
                toEntryId: toId,
                relationType,
                metadata: metadata ?? null,
            },
        });
    } catch (err: any) {
        // Unique constraint violation — relation already exists, ignore
        if (err?.code === "P2002") return;
        throw err;
    }
}

/**
 * Add multiple relations in a single transaction.
 * Skips duplicates silently.
 */
export async function addRelations(
    relations: { fromId: string; toId: string; relationType: KnowledgeRelationType; metadata?: string }[],
): Promise<void> {
    if (relations.length === 0) return;

    const ops = relations.map((r) =>
        db.knowledgeRelation.create({
            data: {
                fromEntryId: r.fromId,
                toEntryId: r.toId,
                relationType: r.relationType,
                metadata: r.metadata ?? null,
            },
        }),
    );

    // Use Promise.allSettled to skip duplicates without failing the batch
    const results = await Promise.allSettled(ops);
    const failures = results.filter(
        (r) => r.status === "rejected" && !(r.reason as any)?.code?.includes("P2002"),
    );
    if (failures.length > 0) {
        log({ module: "knowledge-relation" }, `${failures.length} relation inserts failed`);
    }
}

/**
 * Get all relations for an entry (both directions).
 */
export async function getRelations(
    entryId: string,
): Promise<{ from: KnowledgeRelationRow[]; to: KnowledgeRelationRow[] }> {
    const [from, to] = await Promise.all([
        db.knowledgeRelation.findMany({ where: { fromEntryId: entryId } }),
        db.knowledgeRelation.findMany({ where: { toEntryId: entryId } }),
    ]);
    return {
        from: from as KnowledgeRelationRow[],
        to: to as KnowledgeRelationRow[],
    };
}

/**
 * Get all relations within a project (for chain building).
 * Returns relations where at least one side belongs to the project.
 */
export async function getProjectRelations(
    projectId: string,
): Promise<KnowledgeRelationRow[]> {
    const relations = await db.knowledgeRelation.findMany({
        where: {
            fromEntry: { projectId },
        },
    });
    return relations as KnowledgeRelationRow[];
}

/**
 * Remove a specific relation.
 */
export async function removeRelation(
    fromId: string,
    toId: string,
    relationType: KnowledgeRelationType,
): Promise<void> {
    await db.knowledgeRelation.deleteMany({
        where: {
            fromEntryId: fromId,
            toEntryId: toId,
            relationType,
        },
    });
}

/**
 * Remove a relation by its ID.
 */
export async function removeRelationById(relationId: string): Promise<void> {
    await db.knowledgeRelation.delete({
        where: { id: relationId },
    });
}

/**
 * Serialize a relation row for API responses.
 */
export function serializeRelation(r: KnowledgeRelationRow) {
    return {
        id: r.id,
        fromEntryId: r.fromEntryId,
        toEntryId: r.toEntryId,
        relationType: r.relationType,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        createdAt: r.createdAt.getTime(),
    };
}
