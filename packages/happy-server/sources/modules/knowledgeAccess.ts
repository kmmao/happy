/**
 * Knowledge access tracking module.
 *
 * Records which knowledge entries were referenced (injected) during a session.
 * Also syncs lastAccessedAt + accessCount on ProjectKnowledge for lifecycle decay.
 */

import { db } from "@/storage/db";

/**
 * Fire-and-forget: record that a session accessed a set of knowledge entries.
 * Deduplicates per session+knowledge pair via @@unique constraint + skipDuplicates.
 * Also bumps accessCount and lastAccessedAt on each entry.
 */
export async function recordKnowledgeAccess(
    sessionId: string,
    projectId: string,
    knowledgeIds: string[],
): Promise<void> {
    if (knowledgeIds.length === 0) return;

    const now = new Date();

    await Promise.all([
        // Record access entries (skip duplicates — same session+knowledge)
        db.knowledgeAccess.createMany({
            data: knowledgeIds.map((knowledgeId) => ({
                sessionId,
                knowledgeId,
                projectId,
                at: now,
            })),
            skipDuplicates: true,
        }),
        // Sync lifecycle counters
        db.projectKnowledge.updateMany({
            where: { id: { in: knowledgeIds } },
            data: {
                lastAccessedAt: now,
                accessCount: { increment: 1 },
            },
        }),
    ]);
}

/**
 * Fetch all knowledge entries that were referenced in a session.
 * Returns entries ordered by access time (most recent first).
 */
export async function getSessionKnowledgeAccesses(
    projectId: string,
    sessionId: string,
): Promise<{
    knowledge: {
        id: string;
        entryType: string;
        category: string | null;
        status: string;
        title: string;
        tags: string;
        confidence: string;
        sessionId: string | null;
        createdAt: Date;
    };
    at: Date;
}[]> {
    const accesses = await db.knowledgeAccess.findMany({
        where: { projectId, sessionId },
        orderBy: { at: "desc" },
        select: {
            at: true,
            knowledge: {
                select: {
                    id: true,
                    entryType: true,
                    category: true,
                    status: true,
                    title: true,
                    tags: true,
                    confidence: true,
                    sessionId: true,
                    createdAt: true,
                },
            },
        },
    });

    return accesses;
}
