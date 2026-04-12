import type { AutonomyStats } from "@kmmao/happy-wire";
import { db } from "@/storage/db";
import { resolveWorldAutonomyPolicy } from "./worldSuggestionAutoAccept";

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

export async function getAutonomyStats(
    accountId: string,
    projectId: string,
): Promise<AutonomyStats> {
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { supervisorMode: true, supervisorConfig: true },
    });

    const policy = resolveWorldAutonomyPolicy({
        supervisorMode: project?.supervisorMode ?? null,
        supervisorConfig: project?.supervisorConfig ?? null,
    });

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [todayAutoAccepted, concurrentAutoTasks, recentAutoActions] = await Promise.all([
        db.worldSuggestion.count({
            where: {
                accountId,
                projectId,
                status: "accepted",
                acceptSource: "system_auto",
                actedAt: { gte: dayStart },
            },
        }),
        db.task.count({
            where: {
                accountId,
                projectId,
                triggerType: "suggestion_auto",
                status: { in: ["dispatching", "running"] },
            },
        }),
        db.worldSuggestion.findMany({
            where: {
                accountId,
                projectId,
                status: "accepted",
                acceptSource: "system_auto",
            },
            orderBy: { actedAt: "desc" },
            take: 10,
            select: {
                id: true,
                title: true,
                type: true,
                actedAt: true,
                acceptAudit: true,
            },
        }),
    ]);

    return {
        mode: policy.level,
        todayAutoAccepted,
        todayQuota: policy.maxAutoAcceptsPerDay,
        concurrentAutoTasks,
        maxConcurrent: policy.maxConcurrentAutoTasks,
        recentAutoActions: recentAutoActions.map((s) => {
            const audit = parseAcceptAudit(s.acceptAudit);
            return {
                suggestionId: s.id,
                title: s.title,
                type: s.type as AutonomyStats["recentAutoActions"][number]["type"],
                acceptedAt: s.actedAt ? s.actedAt.getTime() : 0,
                rule: audit?.rule ?? "safe_suggested_task_auto_accept",
            };
        }),
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseAcceptAudit(raw: unknown): { rule: string } | null {
    if (typeof raw !== "string") return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.rule === "string") {
            return { rule: parsed.rule };
        }
    } catch {
        // Ignore malformed audit JSON.
    }
    return null;
}
