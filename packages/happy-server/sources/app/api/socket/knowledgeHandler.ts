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

// Zod schema for socket knowledge submissions (defense-in-depth)
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
            });
            trackKnowledgeCreation(projectId);

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
        data: { sid: string; mode: "auto" | "full" | "minimal"; contextHints?: string[] },
        callback: (response: any) => void,
    ) => {
        try {
            const { sid, mode, contextHints } = data;
            if (!sid || !callback) return;

            const session = await db.session.findFirst({
                where: { id: sid, accountId: userId },
                select: { projectId: true },
            });

            if (!session?.projectId) {
                callback({ profile: null, entries: [] });
                return;
            }

            const projectId = session.projectId;

            // Get profile (L1)
            const profileRecord = await db.projectProfile.findUnique({
                where: { projectId },
            });
            const profile = profileRecord
                ? parseProfileContent(profileRecord.content)
                : null;

            if (mode === "minimal") {
                callback({ profile, entries: [] });
                return;
            }

            // Determine entry limit based on mode
            const entryLimit = mode === "full" ? 20 : 5;

            let entries;
            if (contextHints && contextHints.length > 0) {
                // Keyword-based relevance scoring
                const allActive = await db.projectKnowledge.findMany({
                    where: { projectId, status: "active" },
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
                    where: { projectId, status: "active" },
                    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
                    take: entryLimit,
                });
            }

            callback({
                profile,
                entries: entries.map((e) => ({
                    id: e.id,
                    entryType: e.entryType,
                    title: e.title,
                    content: e.content,
                    tags: safeParseJsonArray(e.tags),
                    confidence: e.confidence,
                    createdAt: e.createdAt.toISOString(),
                })),
            });

            log({ module: "knowledge" }, `Injected ${entries.length} entries for session ${sid} (mode=${mode})`);
        } catch (err) {
            log({ module: "knowledge" }, `Error fetching knowledge: ${err}`);
            if (callback) callback({ profile: null, entries: [] });
        }
    });
}
