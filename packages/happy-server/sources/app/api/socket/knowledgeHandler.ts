import { Socket } from "socket.io";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

/**
 * Handle knowledge submissions from CLI sessions.
 * Receives turn-extracted knowledge entries and stores them
 * with Mem0-style deduplication (title + tag overlap).
 */
export function knowledgeHandler(userId: string, socket: Socket) {
    socket.on("submit-knowledge", async (data: any) => {
        try {
            const { sid, entry } = data;
            if (!sid || !entry?.title || !entry?.content) {
                log({ module: "knowledge" }, "Invalid knowledge submission — missing fields");
                return;
            }

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
            const action = await consolidate(projectId, entry);

            if (action.type === "noop") {
                log({ module: "knowledge" }, `Knowledge dedup: NOOP for "${entry.title.slice(0, 50)}"`);
                return;
            }

            if (action.type === "update" && action.existingId) {
                await db.projectKnowledge.update({
                    where: { id: action.existingId },
                    data: { status: "superseded" },
                });
            }

            await db.projectKnowledge.create({
                data: {
                    projectId,
                    entryType: entry.entryType || "discovery",
                    contributorType: entry.contributorType || "session",
                    action: action.type === "update" ? "supersede" : (entry.action || "create"),
                    title: String(entry.title).slice(0, 200),
                    content: String(entry.content).slice(0, 10000),
                    structured: entry.request || entry.outcome
                        ? JSON.stringify({
                            request: entry.request,
                            outcome: entry.outcome,
                        })
                        : null,
                    tags: JSON.stringify(Array.isArray(entry.tags) ? entry.tags.slice(0, 20) : []),
                    confidence: entry.confidence || "medium",
                    model: entry.model || null,
                    sessionId: sid,
                    affectedFiles: JSON.stringify(Array.isArray(entry.affectedFiles) ? entry.affectedFiles.slice(0, 50) : []),
                    supersedesId: action.type === "update" ? action.existingId : null,
                },
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
            let profile = null;
            if (profileRecord) {
                try {
                    profile = JSON.parse(profileRecord.content);
                } catch {
                    // ignore parse errors
                }
            }

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
                    tags: JSON.parse(e.tags),
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

/**
 * Mem0-style consolidation: title word overlap + tag overlap.
 */
async function consolidate(
    projectId: string,
    entry: { title: string; entryType?: string; tags?: string[] },
): Promise<{ type: "add" } | { type: "update"; existingId: string } | { type: "noop" }> {
    const candidates = await db.projectKnowledge.findMany({
        where: {
            projectId,
            entryType: entry.entryType || "discovery",
            status: "active",
        },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    if (candidates.length === 0) return { type: "add" };

    const newTitleWords = new Set(entry.title.toLowerCase().split(/\s+/));
    const newTags = new Set((entry.tags ?? []).map((t: string) => t.toLowerCase()));

    for (const candidate of candidates) {
        const existingTitleWords = new Set(candidate.title.toLowerCase().split(/\s+/));
        const existingTags = new Set(
            (JSON.parse(candidate.tags) as string[]).map((t: string) => t.toLowerCase()),
        );

        const titleIntersection = [...newTitleWords].filter((w) => existingTitleWords.has(w));
        const titleOverlap = titleIntersection.length / Math.max(newTitleWords.size, existingTitleWords.size);

        const tagIntersection = [...newTags].filter((t) => existingTags.has(t));
        const tagOverlap = newTags.size > 0 && existingTags.size > 0
            ? tagIntersection.length / Math.max(newTags.size, existingTags.size)
            : 0;

        const similarity = titleOverlap * 0.6 + tagOverlap * 0.4;

        if (similarity > 0.7) {
            if (entry.title.length > candidate.title.length * 1.2) {
                return { type: "update", existingId: candidate.id };
            }
            return { type: "noop" };
        }
    }

    return { type: "add" };
}
