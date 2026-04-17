/**
 * Knowledge access tracking module.
 *
 * Records which knowledge entries were referenced (injected) during a session.
 * Also syncs lastAccessedAt + accessCount on ProjectKnowledge for lifecycle decay.
 *
 * Session-scoped TTL-by-turn (migrate-out countdown):
 *   - On injection: seed turnsRemaining by confidence (high=7, medium=5, low=3).
 *                   maxTurns caps the +1 growth on hits (2× initial).
 *   - On turn end: hits increment turnsRemaining (up to maxTurns) and hitCount;
 *                  misses decrement turnsRemaining; at ≤ 0 hotStatus becomes "evicted".
 *   - Evicted entries are excluded from future in-session injections.
 */

import { db } from "@/storage/db";

// ─── Initial turn budgets per confidence ───

const INITIAL_TURNS: Record<string, number> = {
    high: 7,
    medium: 5,
    low: 3,
};

const MAX_TURN_MULTIPLIER = 2; // cap = initial × 2

export function getInitialTurnBudget(confidence: string): { initialTurns: number; maxTurns: number } {
    const initialTurns = INITIAL_TURNS[confidence] ?? INITIAL_TURNS.medium;
    return { initialTurns, maxTurns: initialTurns * MAX_TURN_MULTIPLIER };
}

interface AccessEntry {
    id: string;
    confidence: string;
}

/**
 * Fire-and-forget: record that a session accessed a set of knowledge entries.
 * On first access seeds turn budget; on re-access re-activates hot status and tops up turns.
 * Also bumps global accessCount and lastAccessedAt on each entry.
 */
export async function recordKnowledgeAccess(
    sessionId: string,
    projectId: string,
    entries: Array<AccessEntry | string>,
): Promise<void> {
    if (entries.length === 0) return;

    const now = new Date();
    const normalized: AccessEntry[] = entries.map((e) =>
        typeof e === "string" ? { id: e, confidence: "medium" } : e,
    );
    const knowledgeIds = normalized.map((e) => e.id);

    // Load existing access rows to decide insert vs re-activate
    const existing = await db.knowledgeAccess.findMany({
        where: { sessionId, knowledgeId: { in: knowledgeIds } },
        select: { knowledgeId: true, hotStatus: true, turnsRemaining: true, initialTurns: true, maxTurns: true },
    });
    const existingMap = new Map(existing.map((e) => [e.knowledgeId, e]));

    const toCreate: AccessEntry[] = [];
    const toReactivate: AccessEntry[] = [];
    for (const entry of normalized) {
        const prev = existingMap.get(entry.id);
        if (!prev) {
            toCreate.push(entry);
        } else if (prev.hotStatus === "evicted" || prev.turnsRemaining < prev.initialTurns) {
            toReactivate.push(entry);
        }
    }

    const ops: Promise<unknown>[] = [];

    if (toCreate.length > 0) {
        ops.push(
            db.knowledgeAccess.createMany({
                data: toCreate.map((entry) => {
                    const { initialTurns, maxTurns } = getInitialTurnBudget(entry.confidence);
                    return {
                        sessionId,
                        knowledgeId: entry.id,
                        projectId,
                        at: now,
                        initialTurns,
                        maxTurns,
                        turnsRemaining: initialTurns,
                        hotStatus: "hot",
                    };
                }),
                skipDuplicates: true,
            }),
        );
    }

    // Re-inject: reset countdown to initialTurns and flip back to hot.
    for (const entry of toReactivate) {
        const { initialTurns } = getInitialTurnBudget(entry.confidence);
        ops.push(
            db.knowledgeAccess.updateMany({
                where: { sessionId, knowledgeId: entry.id },
                data: {
                    turnsRemaining: initialTurns,
                    hotStatus: "hot",
                    at: now,
                },
            }),
        );
    }

    // Global lifecycle counters on ProjectKnowledge
    ops.push(
        db.projectKnowledge.updateMany({
            where: { id: { in: knowledgeIds } },
            data: {
                lastAccessedAt: now,
                accessCount: { increment: 1 },
            },
        }),
    );

    await Promise.all(ops);
}

/**
 * Pure decision logic for a turn-end event. Given the hot rows and the hit ids,
 * returns which rows should be incremented (below-cap hits), which should be hit-only
 * (at-cap hits, just bump hitCount), which should be decremented, and which evict.
 *
 * Separated so it can be unit-tested without DB.
 */
export interface TurnHitRow {
    knowledgeId: string;
    turnsRemaining: number;
    maxTurns: number;
}

export interface TurnHitPlan {
    hitIncrementIds: string[]; // +1 turnsRemaining, +1 hitCount, lastHitAt=now
    hitAtCapIds: string[];     // +1 hitCount only (already at cap)
    decrementIds: string[];    // -1 turnsRemaining (still hot after)
    evictIds: string[];        // set turnsRemaining=0, hotStatus=evicted
    hit: number;
    miss: number;
    evicted: number;
}

export function computeTurnHitPlan(
    hotRows: TurnHitRow[],
    hitKnowledgeIds: Iterable<string>,
): TurnHitPlan {
    const hitSet = new Set(hitKnowledgeIds);

    const hitIncrementIds: string[] = [];
    const hitAtCapIds: string[] = [];
    const decrementIds: string[] = [];
    const evictIds: string[] = [];

    for (const row of hotRows) {
        if (hitSet.has(row.knowledgeId)) {
            if (row.turnsRemaining >= row.maxTurns) {
                hitAtCapIds.push(row.knowledgeId);
            } else {
                hitIncrementIds.push(row.knowledgeId);
            }
        } else if (row.turnsRemaining - 1 <= 0) {
            evictIds.push(row.knowledgeId);
        } else {
            decrementIds.push(row.knowledgeId);
        }
    }

    return {
        hitIncrementIds,
        hitAtCapIds,
        decrementIds,
        evictIds,
        hit: hitIncrementIds.length + hitAtCapIds.length,
        miss: decrementIds.length + evictIds.length,
        evicted: evictIds.length,
    };
}

/**
 * Apply a turn end event: for the given session, increment turnsRemaining and hitCount for hit
 * entries (capped at maxTurns), decrement for non-hit hot entries, and evict ones that reached 0.
 *
 * Returns summary counts for logging/ephemeral push.
 */
export async function applyTurnHit(
    sessionId: string,
    hitKnowledgeIds: string[],
): Promise<{ hit: number; miss: number; evicted: number }> {
    const now = new Date();

    // Read all currently-hot rows for this session.
    const hot = await db.knowledgeAccess.findMany({
        where: { sessionId, hotStatus: "hot" },
        select: { knowledgeId: true, turnsRemaining: true, maxTurns: true },
    });

    if (hot.length === 0) return { hit: 0, miss: 0, evicted: 0 };

    const plan = computeTurnHitPlan(hot, hitKnowledgeIds);

    const ops: Promise<unknown>[] = [];

    if (plan.hitAtCapIds.length > 0) {
        ops.push(
            db.knowledgeAccess.updateMany({
                where: { sessionId, knowledgeId: { in: plan.hitAtCapIds } },
                data: { hitCount: { increment: 1 }, lastHitAt: now },
            }),
        );
    }
    if (plan.hitIncrementIds.length > 0) {
        ops.push(
            db.knowledgeAccess.updateMany({
                where: { sessionId, knowledgeId: { in: plan.hitIncrementIds } },
                data: {
                    turnsRemaining: { increment: 1 },
                    hitCount: { increment: 1 },
                    lastHitAt: now,
                },
            }),
        );
    }
    if (plan.decrementIds.length > 0) {
        ops.push(
            db.knowledgeAccess.updateMany({
                where: { sessionId, knowledgeId: { in: plan.decrementIds } },
                data: { turnsRemaining: { decrement: 1 } },
            }),
        );
    }
    if (plan.evictIds.length > 0) {
        ops.push(
            db.knowledgeAccess.updateMany({
                where: { sessionId, knowledgeId: { in: plan.evictIds } },
                data: { turnsRemaining: 0, hotStatus: "evicted" },
            }),
        );
    }

    await Promise.all(ops);

    return { hit: plan.hit, miss: plan.miss, evicted: plan.evicted };
}

/**
 * Get the set of knowledgeIds that are currently evicted in this session,
 * so the fetch-knowledge handler can skip them in future injections.
 */
export async function getEvictedKnowledgeIds(sessionId: string): Promise<Set<string>> {
    const rows = await db.knowledgeAccess.findMany({
        where: { sessionId, hotStatus: "evicted" },
        select: { knowledgeId: true },
    });
    return new Set(rows.map((r) => r.knowledgeId));
}

/**
 * Get high-level hot-set stats for a session (for App Summary tab).
 */
export async function getSessionHotStats(
    sessionId: string,
): Promise<{ injected: number; referenced: number; hot: number; evicted: number }> {
    const rows = await db.knowledgeAccess.findMany({
        where: { sessionId },
        select: { hitCount: true, hotStatus: true },
    });
    let referenced = 0;
    let hot = 0;
    let evicted = 0;
    for (const r of rows) {
        if (r.hitCount > 0) referenced++;
        if (r.hotStatus === "hot") hot++;
        else if (r.hotStatus === "evicted") evicted++;
    }
    return { injected: rows.length, referenced, hot, evicted };
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
    hitCount: number;
    turnsRemaining: number;
    maxTurns: number;
    initialTurns: number;
    hotStatus: string;
    lastHitAt: Date | null;
}[]> {
    const accesses = await db.knowledgeAccess.findMany({
        where: { projectId, sessionId },
        orderBy: { at: "desc" },
        select: {
            at: true,
            hitCount: true,
            turnsRemaining: true,
            maxTurns: true,
            initialTurns: true,
            hotStatus: true,
            lastHitAt: true,
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
