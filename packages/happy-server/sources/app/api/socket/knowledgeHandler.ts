import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { consolidate } from "@/modules/knowledgeConsolidate";
import { parseProfileContent, safeParseJsonArray } from "@/modules/knowledgeSerialize";
import { storeKnowledgeEmbedding } from "@/modules/knowledgeEmbedding";
import { trackKnowledgeCreation } from "@/modules/knowledgeAutoProfile";
import { refineKnowledgeEntry } from "@/modules/knowledgeRefiner";
import { buildKnowledgeCountEphemeral, eventRouter } from "@/app/events/eventRouter";
import { inTx } from "@/storage/inTx";
import { addRelations, type KnowledgeRelationType } from "@/modules/knowledgeRelation";
import { resolveKnowledgeConfig } from "@/modules/knowledgeConfigResolver";
import {
    applyTurnHit,
    getEvictedKnowledgeIds,
    recordKnowledgeAccess,
} from "@/modules/knowledgeAccess";

// Zod schemas for socket knowledge events (defense-in-depth)
const FetchKnowledgeSchema = z.object({
    sid: z.string().min(1),
    mode: z.enum(["auto", "full", "minimal"]).default("auto"),
    contextHints: z.array(z.string().max(200)).max(20).optional(),
});

// Per-turn hit report from CLI. hitIds are ProjectKnowledge ids the CLI detected
// as referenced during the turn (tag/file/title match against assistant output).
const KnowledgeTurnEndSchema = z.object({
    sid: z.string().min(1),
    hitIds: z.array(z.string().min(1)).max(100).default([]),
});

const SubmitKnowledgeSchema = z.object({
    sid: z.string().min(1),
    entry: z.object({
        entryType: z.enum(["discovery", "decision", "fix", "convention", "warning"]).default("discovery"),
        contributorType: z.enum(["session", "supervisor", "user"]).default("session"),
        action: z.enum(["create", "amend", "supersede", "verify"]).default("create"),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(10000),
        request: z.string().optional(),
        outcome: z.string().optional(),
        tags: z.array(z.string().max(50)).max(20).default([]),
        confidence: z.enum(["high", "medium", "low"]).default("medium"),
        model: z.string().optional(),
        affectedFiles: z.array(z.string()).max(50).default([]),
        relatedIds: z.array(z.string()).max(10).default([]),
    }),
});

/**
 * Handle knowledge submissions from CLI sessions.
 * Receives turn-extracted knowledge entries and stores them
 * with Mem0-style deduplication (title + tag overlap).
 */
export function knowledgeHandler(userId: string, socket: Socket) {
    socket.on("submit-knowledge", async (data: unknown) => {
        try {
            const parsed = SubmitKnowledgeSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "knowledge" }, `Invalid knowledge submission: ${parsed.error.message.slice(0, 200)}`);
                return;
            }

            const { sid, entry } = parsed.data;

            // Find the session to get project association
            const session = await db.session.findFirst({
                where: { id: sid, accountId: userId },
                select: { id: true, projectId: true },
            });

            if (!session?.projectId) {
                log({ module: "knowledge" }, `No project linked to session ${sid}`);
                return;
            }

            const projectId = session.projectId;

            // Mem0-style dedup: check for similar active entries
            const action = await consolidate(projectId, {
                title: entry.title,
                entryType: entry.entryType,
                tags: entry.tags,
                content: entry.content,
            });

            if (action.type === "noop") {
                log({ module: "knowledge" }, `Knowledge dedup: NOOP for "${entry.title.slice(0, 50)}"`);
                return;
            }

            const created = await inTx(async (tx) => {
                if (action.type === "update" && action.existingId) {
                    await tx.projectKnowledge.update({
                        where: { id: action.existingId },
                        data: { status: "superseded" },
                    });
                }

                return tx.projectKnowledge.create({
                    data: {
                        projectId,
                        entryType: entry.entryType,
                        contributorType: entry.contributorType,
                        action: action.type === "update" ? "supersede" : entry.action,
                        title: entry.title,
                        content: entry.content,
                        structured: entry.request || entry.outcome
                            ? JSON.stringify({
                                request: entry.request,
                                outcome: entry.outcome,
                            })
                            : null,
                        tags: JSON.stringify(entry.tags),
                        confidence: entry.confidence,
                        model: entry.model ?? null,
                        sessionId: sid,
                        affectedFiles: JSON.stringify(entry.affectedFiles),
                        relatedIds: JSON.stringify(entry.relatedIds),
                        supersedesId: action.type === "update" ? action.existingId : null,
                    },
                });
            });

            // Fire-and-forget: generate embedding for semantic search
            void storeKnowledgeEmbedding(created.id, entry.title, entry.content);
            // Fire-and-forget: LLM refinement (rewrites title/content/structured in-place)
            void refineKnowledgeEntry({
                id: created.id,
                title: entry.title,
                content: entry.content,
                entryType: entry.entryType,
                tags: JSON.stringify(entry.tags),
                confidence: entry.confidence,
                structured: entry.request || entry.outcome
                    ? JSON.stringify({ request: entry.request, outcome: entry.outcome })
                    : null,
                projectId,
            });
            trackKnowledgeCreation(projectId);

            // Dual-write: persist relatedIds to KnowledgeRelation table
            if (entry.relatedIds.length > 0) {
                void addRelations(
                    entry.relatedIds.map((toId) => ({
                        fromId: created.id,
                        toId,
                        relationType: "related" as KnowledgeRelationType,
                    })),
                );
            }
            // If this is a supersede action, also create a "refines" relation
            if (action.type === "update" && action.existingId) {
                void addRelations([{
                    fromId: created.id,
                    toId: action.existingId,
                    relationType: "refines" as KnowledgeRelationType,
                }]);
            }

            // Push knowledge count to App (ephemeral, user-scoped only)
            const knowledgeCount = await db.projectKnowledge.count({
                where: { sessionId: sid, status: "active" },
            });
            eventRouter.emitEphemeral({
                userId,
                payload: buildKnowledgeCountEphemeral(sid, knowledgeCount),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "knowledge" }, `Knowledge ${action.type}: "${entry.title.slice(0, 50)}" for project ${projectId}`);
        } catch (err) {
            log({ module: "knowledge" }, `Error handling knowledge submission: ${err}`);
        }
    });

    // Fetch knowledge for injection into new sessions (emitWithAck pattern)
    socket.on("fetch-knowledge", async (
        data: unknown,
        callback: (response: any) => void,
    ) => {
        try {
            if (!callback) return;
            const parsed = FetchKnowledgeSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "knowledge" }, `Invalid fetch-knowledge request: ${parsed.error.message.slice(0, 200)}`);
                callback({ profile: null, entries: [] });
                return;
            }
            const { sid, contextHints } = parsed.data;

            const session = await db.session.findFirst({
                where: { id: sid, accountId: userId },
                select: { projectId: true },
            });

            if (!session?.projectId) {
                callback({ profile: null, entries: [], actionItems: [] });
                return;
            }

            const projectId = session.projectId;

            // Resolve project-level config first — use stored mode, not client-sent mode
            const knowledgeConfig = await resolveKnowledgeConfig(projectId);
            const effectiveMode = knowledgeConfig.mode;

            // Get profile (L1)
            const profileRecord = await db.projectProfile.findUnique({
                where: { projectId },
            });
            const profile = profileRecord
                ? parseProfileContent(profileRecord.content)
                : null;

            if (effectiveMode === "minimal") {
                callback({ profile, entries: [], actionItems: [], knowledgeConfig });
                return;
            }

            // Determine entry limit based on stored mode
            const entryLimit = effectiveMode === "full" ? 20 : 5;

            // Skip entries that have already been evicted in this session (migrate-out countdown hit zero).
            const evictedIds = await getEvictedKnowledgeIds(sid);

            let entries;
            if (contextHints && contextHints.length > 0) {
                // Keyword-based relevance scoring
                const allActive = await db.projectKnowledge.findMany({
                    where: {
                        projectId,
                        status: "active",
                        ...(evictedIds.size > 0 ? { id: { notIn: [...evictedIds] } } : {}),
                    },
                    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
                    take: 100,
                });
                const scored = allActive.map((e) => {
                    const text = `${e.title} ${e.tags} ${e.content}`.toLowerCase();
                    const score = contextHints.reduce(
                        (acc: number, hint: string) => acc + (text.includes(hint.toLowerCase()) ? 1 : 0),
                        0,
                    );
                    return { entry: e, score };
                });
                scored.sort((a, b) => b.score - a.score || b.entry.createdAt.getTime() - a.entry.createdAt.getTime());
                entries = scored.slice(0, entryLimit).map((s) => s.entry);
            } else {
                entries = await db.projectKnowledge.findMany({
                    where: {
                        projectId,
                        status: "active",
                        ...(evictedIds.size > 0 ? { id: { notIn: [...evictedIds] } } : {}),
                    },
                    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
                    take: entryLimit,
                });
            }

            // Fire-and-forget: record access log (writes knowledgeAccess records + bumps counters)
            if (entries.length > 0) {
                void recordKnowledgeAccess(
                    sid,
                    projectId,
                    entries.map((e) => ({ id: e.id, confidence: e.confidence })),
                );
            }

            // Fetch action items: warning/decision entries + high-confidence not recently accessed
            const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            const mainEntryIds = entries.map((e) => e.id);
            const actionItems = await db.projectKnowledge.findMany({
                where: {
                    projectId,
                    status: "active",
                    ...(mainEntryIds.length > 0 ? { id: { notIn: mainEntryIds } } : {}),
                    OR: [
                        { entryType: { in: ["warning", "decision"] } },
                        {
                            confidence: "high",
                            OR: [
                                { lastAccessedAt: null },
                                { lastAccessedAt: { lt: fourteenDaysAgo } },
                            ],
                        },
                    ],
                },
                orderBy: [{ pinned: "desc" }, { confidence: "desc" }, { lastAccessedAt: "asc" }],
                take: 5,
            });

            callback({
                profile,
                entries: entries.map((e) => ({
                    id: e.id,
                    entryType: e.entryType,
                    category: e.category,
                    title: e.title,
                    content: e.content,
                    tags: safeParseJsonArray(e.tags),
                    confidence: e.confidence,
                    createdAt: e.createdAt.toISOString(),
                })),
                actionItems: actionItems.map((e) => ({
                    id: e.id,
                    entryType: e.entryType,
                    title: e.title,
                    content: e.content,
                    tags: safeParseJsonArray(e.tags),
                    confidence: e.confidence,
                    createdAt: e.createdAt.toISOString(),
                })),
                knowledgeConfig,
            });

            log({ module: "knowledge" }, `Injected ${entries.length} entries + ${actionItems.length} action items for session ${sid} (mode=${effectiveMode})`);
        } catch (err) {
            log({ module: "knowledge" }, `Error fetching knowledge: ${err}`);
            if (callback) callback({ profile: null, entries: [] });
        }
    });

    // Per-turn hit report: CLI tells us which injected entries were actually referenced
    // by the assistant in the finished turn. Hits top up the turn budget; misses tick down.
    // When a row's turnsRemaining hits 0 it is evicted from future injections in this session.
    socket.on("knowledge-turn-end", async (data: unknown) => {
        try {
            const parsed = KnowledgeTurnEndSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "knowledge" }, `Invalid knowledge-turn-end: ${parsed.error.message.slice(0, 200)}`);
                return;
            }
            const { sid, hitIds } = parsed.data;

            // Confirm the session belongs to this user before mutating state.
            const session = await db.session.findFirst({
                where: { id: sid, accountId: userId },
                select: { id: true },
            });
            if (!session) return;

            const summary = await applyTurnHit(sid, hitIds);
            log(
                { module: "knowledge" },
                `Turn-end ${sid}: hit=${summary.hit} miss=${summary.miss} evicted=${summary.evicted}`,
            );
        } catch (err) {
            log({ module: "knowledge" }, `Error handling knowledge-turn-end: ${err}`);
        }
    });
}
