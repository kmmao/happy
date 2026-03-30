import { db } from "@/storage/db";
import { log } from "@/utils/log";

// ─── Configuration (overridable via env) ───

const DECAY_THRESHOLD_DAYS = parseInt(process.env.KNOWLEDGE_DECAY_THRESHOLD_DAYS ?? "30", 10);
const DECAY_BATCH_SIZE = 50;
const DECAY_MIN_AGE_DAYS = 7; // Don't decay entries younger than 7 days

// ─── Confidence weights (higher = decays faster) ───

const CONFIDENCE_WEIGHT: Record<string, number> = {
    high: 0.3,
    medium: 0.6,
    low: 1.0,
};

/**
 * Calculate decay score for a knowledge entry.
 * Pure function — no DB access, easy to test.
 *
 * Score > DECAY_THRESHOLD_DAYS → archive candidate
 * Returns 0 for pinned entries (never decay).
 */
export function calculateDecayScore(entry: {
    lastAccessedAt: Date | null;
    createdAt: Date;
    accessCount: number;
    confidence: string;
    pinned: boolean;
}): number {
    // Pinned entries never decay
    if (entry.pinned) return 0;

    const now = Date.now();
    const referenceDate = entry.lastAccessedAt ?? entry.createdAt;
    const daysSinceAccess = (now - referenceDate.getTime()) / (1000 * 60 * 60 * 24);

    const confidenceWeight = CONFIDENCE_WEIGHT[entry.confidence] ?? 0.6;

    // Access bonus: frequently accessed entries decay slower (capped at 0.5)
    const accessBonus = Math.min(entry.accessCount * 0.1, 0.5);

    // Final score: weighted days minus access bonus scaled to threshold
    const score = daysSinceAccess * confidenceWeight - accessBonus * DECAY_THRESHOLD_DAYS;

    return Math.max(0, score);
}

/**
 * Run decay archive for a single project.
 * Finds entries that exceed the decay threshold and archives them.
 * Uses cursor-based pagination to avoid loading too many records at once.
 *
 * Returns the number of entries archived.
 */
export async function runDecayArchive(projectId: string): Promise<{ archived: number }> {
    let archived = 0;
    let cursor: string | undefined;

    const minCreatedAt = new Date(Date.now() - DECAY_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const entries = await db.projectKnowledge.findMany({
            where: {
                projectId,
                status: "active",
                pinned: false,
                createdAt: { lt: minCreatedAt },
            },
            select: {
                id: true,
                lastAccessedAt: true,
                createdAt: true,
                accessCount: true,
                confidence: true,
                pinned: true,
            },
            orderBy: { createdAt: "asc" },
            take: DECAY_BATCH_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (entries.length === 0) break;

        const toArchive: string[] = [];
        for (const entry of entries) {
            const score = calculateDecayScore(entry);
            if (score > DECAY_THRESHOLD_DAYS) {
                toArchive.push(entry.id);
            }
        }

        if (toArchive.length > 0) {
            await db.projectKnowledge.updateMany({
                where: { id: { in: toArchive } },
                data: { status: "archived" },
            });
            archived += toArchive.length;
        }

        cursor = entries[entries.length - 1].id;

        // If we got fewer than batch size, we've reached the end
        if (entries.length < DECAY_BATCH_SIZE) break;
    }

    return { archived };
}

/**
 * Run decay archive across all projects.
 * Iterates over distinct project IDs that have active knowledge entries.
 */
export async function runGlobalDecayArchive(): Promise<{
    totalArchived: number;
    projectsProcessed: number;
}> {
    let totalArchived = 0;
    let projectsProcessed = 0;

    try {
        // Get distinct project IDs with active entries older than min age
        const minCreatedAt = new Date(Date.now() - DECAY_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
        const projects = await db.projectKnowledge.findMany({
            where: {
                status: "active",
                pinned: false,
                createdAt: { lt: minCreatedAt },
            },
            select: { projectId: true },
            distinct: ["projectId"],
        });

        for (const { projectId } of projects) {
            const result = await runDecayArchive(projectId);
            totalArchived += result.archived;
            projectsProcessed++;
        }

        if (totalArchived > 0) {
            log(
                { module: "knowledge-decay" },
                `Decay archive: archived ${totalArchived} entries across ${projectsProcessed} projects`,
            );
        }
    } catch (err) {
        log({ module: "knowledge-decay" }, `Global decay archive failed: ${err}`);
    }

    return { totalArchived, projectsProcessed };
}
