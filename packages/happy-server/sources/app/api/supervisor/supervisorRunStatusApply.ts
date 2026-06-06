/**
 * Deep completion module for supervisor run status callbacks.
 *
 * TWO transports hand this module a validated status update and get back one
 * structured outcome:
 *   - the daemon's socket `supervisor-run-status` event, and
 *   - Claude's in-session curl POST → the run-status route.
 * Both used to inline their own copy of "a run reached status X", and the two
 * copies had silently drifted — one path computed a health score and archived
 * the session, the other sent the push / inbox / knowledge notifications, so
 * the side effects a run got depended on which transport reported it. This
 * module is the union of both: everything a "run reached status X" means lives
 * here exactly once — the atomic pending/running → terminal transition, action
 * de-duplication (including skipped/ignored resurfacing), health scoring, usage
 * aggregation, session archival, App + daemon notifications, push, inbox,
 * knowledge contribution, auto-approval, and loop progression.
 *
 * Because the transition is a single atomic `updateMany` guarded by the current
 * status, only the FIRST transport to flip a run terminal runs the side
 * effects; a second report for the same run loses the compare-and-swap and
 * returns `409` before notifying anyone, so the union never double-fires.
 *
 * The interface is a small `(input) -> SupervisorRunStatusResult`. The four
 * rejection outcomes (run-not-found, machine-mismatch, invalid-session,
 * already-terminal) are values on `{ ok: false }`, so the HTTP adapter maps
 * them to status codes without re-deriving them, and the orchestration is
 * testable without Fastify or a socket. Loop progression is invoked exactly
 * once, here, as an internal seam.
 *
 * The two transports authenticate differently, so the one legitimate
 * difference is parameterized: `enforceMachineMatch` makes the curl callback
 * (authenticated only by a callback token carrying a machineId) prove the run's
 * project belongs to that machine, while the daemon socket — already
 * authenticated as the machine by its connection — passes `false`.
 */

import { Prisma, type SupervisorRun } from "@prisma/client";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorStatusEphemeral,
    buildSessionActivityEphemeral,
} from "@/app/events/eventRouter";
import { computeHealthScore, countSeverities } from "@/modules/supervisorScoring";
import { aggregateSessionUsage, scheduleDelayedCostAggregation } from "@/modules/supervisorUsage";
import { activityCache } from "@/app/presence/sessionCache";
import { maybeAutoStartLoop } from "@/modules/supervisorAutoLoop";
import { onRunCompleted as loopOnRunCompleted } from "@/modules/supervisorLoopEngine";
import { handleAutoApproval } from "./supervisorAutoApproval";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { inboxCreate } from "@/modules/inboxCreate";
import { contributeSupervisorKnowledge } from "@/modules/knowledgeContributor";

/** A single finding reported alongside a terminal status. */
export interface SupervisorRunStatusAction {
    severity: "critical" | "high" | "medium" | "low";
    category: string;
    title: string;
    description: string;
    suggestedFix?: string;
    confidence?: number;
}

/** Validated, authenticated input for one run-status callback. */
export interface SupervisorRunStatusApplyInput {
    userId: string;
    machineId: string | null;
    /**
     * Whether to reject the update unless `machineId` matches the run's
     * project machine. The curl callback (weakly authenticated by a callback
     * token) sets `true`; the daemon socket — authenticated as the machine by
     * its own connection — sets `false`.
     */
    enforceMachineMatch: boolean;
    projectId: string;
    runId: string;
    status: "running" | "completed" | "failed";
    artifactId?: string;
    sessionId?: string;
    actionsCount?: number;
    issuesCreated?: number;
    errorMessage?: string;
    /** Initial usage from the daemon report; overwritten if a UsageReport is found. */
    tokenCount?: number;
    costUsd?: number;
    currentDimension?: string;
    dimensionIndex?: number;
    totalDimensions?: number;
    reportTitle?: string;
    reportContent?: string;
    actions?: SupervisorRunStatusAction[];
}

/**
 * Outcome of applying a run-status callback. `{ ok: false }` carries the HTTP
 * status the adapter should reply with; `{ ok: true }` carries the refreshed
 * run record (or null if it could not be re-read) for serialization.
 */
export type SupervisorRunStatusResult =
    | { ok: false; status: 403 | 404; error: string }
    | { ok: false; status: 409; error: string }
    | { ok: true; run: SupervisorRun | null };

export async function supervisorRunStatusApply(
    input: SupervisorRunStatusApplyInput,
): Promise<SupervisorRunStatusResult> {
    const {
        userId,
        machineId,
        enforceMachineMatch,
        projectId: id,
        runId,
        status,
        artifactId,
        sessionId,
        actionsCount,
        issuesCreated,
        errorMessage,
        tokenCount,
        costUsd,
        currentDimension,
        dimensionIndex,
        totalDimensions,
        reportTitle,
        reportContent,
        actions: reportedActions,
    } = input;

    const run = await db.supervisorRun.findFirst({
        where: {
            id: runId,
            projectId: id,
            accountId: userId,
        },
        select: {
            id: true,
            sessionId: true,
            project: {
                select: {
                    machineId: true,
                },
            },
        },
    });

    if (!run) {
        return { ok: false, status: 404, error: "Supervisor run not found" };
    }

    // The curl callback proves machine ownership; the daemon socket is already
    // authenticated as the machine by its connection and skips this.
    if (enforceMachineMatch && (!machineId || run.project.machineId !== machineId)) {
        return { ok: false, status: 403, error: "Machine mismatch" };
    }

    if (sessionId) {
        const matchedSession = await db.session.findFirst({
            where: {
                id: sessionId,
                accountId: userId,
                projectId: id,
            },
            select: { id: true },
        });
        if (!matchedSession) {
            return { ok: false, status: 403, error: "Invalid session for machine" };
        }
    }

    // Atomic: only update if status is still pending/running
    const data: Prisma.SupervisorRunUpdateManyMutationInput = {
        status,
    };
    if (artifactId !== undefined) data.artifactId = artifactId;
    if (sessionId !== undefined) data.sessionId = sessionId;
    if (actionsCount !== undefined) data.actionsCount = actionsCount;
    if (issuesCreated !== undefined) data.issuesCreated = issuesCreated;
    if (errorMessage !== undefined) data.errorMessage = errorMessage;
    if (tokenCount !== undefined) data.tokenCount = tokenCount;
    if (costUsd !== undefined) data.costUsd = costUsd;
    if (reportTitle !== undefined) data.reportTitle = reportTitle;
    if (reportContent !== undefined) data.reportContent = reportContent;
    if (status === "completed" || status === "failed") {
        data.completedAt = new Date();
    }

    const result = await db.supervisorRun.updateMany({
        where: {
            id: runId,
            projectId: id,
            accountId: userId,
            status: { in: ["pending", "running"] },
        },
        data,
    });

    if (result.count === 0) {
        // Check if run exists but is already in a terminal state
        const existing = await db.supervisorRun.findFirst({
            where: { id: runId, projectId: id, accountId: userId },
            select: { status: true },
        });

        if (!existing) {
            return { ok: false, status: 404, error: "Supervisor run not found" };
        }

        return { ok: false, status: 409, error: `Run is already ${existing.status}` };
    }

    // Action de-duplication runs on ANY status that carries findings (the
    // daemon may report them before the terminal status), with the full
    // skipped/ignored resurfacing rules: a finding that matches a previously
    // `skipped` action restores it to `pending`, one matching an `ignored`
    // action stays suppressed (only its lastSeenRunId is bumped), and an
    // unmatched finding is created fresh.
    if (reportedActions && reportedActions.length > 0) {
        const existingActions = await db.supervisorAction.findMany({
            where: {
                projectId: id,
                accountId: userId,
                approval: { in: ["pending", "skipped", "ignored"] },
            },
            select: {
                id: true,
                category: true,
                title: true,
                approval: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
        });

        // category::title → { id, approval }. When several rows share a key,
        // prefer pending > skipped > ignored.
        const approvalPriority: Record<string, number> = {
            pending: 3,
            skipped: 2,
            ignored: 1,
        };
        const existingKeys = new Map<string, { id: string; approval: string }>();
        for (const a of existingActions) {
            const key = `${a.category}::${a.title}`;
            const existing = existingKeys.get(key);
            if (!existing || (approvalPriority[a.approval] ?? 0) > (approvalPriority[existing.approval] ?? 0)) {
                existingKeys.set(key, { id: a.id, approval: a.approval });
            }
        }

        const newActions: typeof reportedActions = [];
        const updatedIds: string[] = [];
        const restoredIds: string[] = [];
        const suppressedIds: string[] = [];
        const batchOps: ReturnType<typeof db.supervisorAction.update>[] = [];

        for (const action of reportedActions) {
            const key = `${action.category}::${action.title}`;
            const existing = existingKeys.get(key);
            if (!existing) {
                newActions.push(action);
            } else if (existing.approval === "pending") {
                batchOps.push(
                    db.supervisorAction.update({
                        where: { id: existing.id },
                        data: {
                            lastSeenRunId: runId,
                            description: action.description,
                            suggestedFix: action.suggestedFix ?? null,
                            confidence: action.confidence ?? null,
                            severity: action.severity,
                        },
                    }),
                );
                updatedIds.push(existing.id);
            } else if (existing.approval === "skipped") {
                batchOps.push(
                    db.supervisorAction.update({
                        where: { id: existing.id },
                        data: {
                            approval: "pending",
                            lastSeenRunId: runId,
                            description: action.description,
                            suggestedFix: action.suggestedFix ?? null,
                            confidence: action.confidence ?? null,
                            severity: action.severity,
                        },
                    }),
                );
                restoredIds.push(existing.id);
            } else if (existing.approval === "ignored") {
                batchOps.push(
                    db.supervisorAction.update({
                        where: { id: existing.id },
                        data: { lastSeenRunId: runId },
                    }),
                );
                suppressedIds.push(existing.id);
            }
        }

        if (batchOps.length > 0) {
            await db.$transaction(batchOps);
        }

        if (newActions.length > 0) {
            await db.supervisorAction.createMany({
                data: newActions.map((action) => ({
                    runId,
                    projectId: id,
                    accountId: userId,
                    severity: action.severity,
                    category: action.category,
                    title: action.title,
                    description: action.description,
                    suggestedFix: action.suggestedFix ?? null,
                    confidence: action.confidence ?? null,
                })),
            });
        }

        await db.supervisorRun.update({
            where: { id: runId },
            data: { actionsCount: reportedActions.length },
        });

        log(
            { module: "supervisor" },
            `supervisor-run-status: ${newActions.length} new, ${updatedIds.length} deduped, ${restoredIds.length} restored from skip, ${suppressedIds.length} suppressed by ignore`,
        );

        // Contribute findings to the knowledge base, terminal status only.
        if (status === "completed") {
            void contributeSupervisorKnowledge(id, runId, reportedActions);
        }
    }

    // Compute and persist healthScore + usage on completion, then archive.
    if (status === "completed") {
        const allActions = await db.supervisorAction.findMany({
            where: { runId, projectId: id, accountId: userId },
            select: { severity: true },
        });
        const counts = countSeverities(allActions);
        const healthScore = computeHealthScore(counts);

        // Aggregate session usage (cost/tokens) from UsageReport
        const runForSession = await db.supervisorRun.findUnique({
            where: { id: runId },
            select: { sessionId: true },
        });
        const resolvedSessionId = sessionId ?? runForSession?.sessionId;
        const usage = await aggregateSessionUsage(resolvedSessionId);

        await db.supervisorRun.update({
            where: { id: runId },
            data: {
                healthScore,
                ...(usage
                    ? {
                          tokenCount: usage.totalTokens,
                          costUsd: usage.totalCostUsd,
                      }
                    : {}),
            },
        });

        // ADR-0022 D-1 — autonomous loop discovery. If the project has an
        // auto-loop threshold set and this standalone run reports a
        // healthScore at/above it, spawn a supervisor-role AgentLoop. The
        // helper is best-effort: skipped silently when the run is already
        // inside a loop, debounce window is active, or startLoop's own
        // guards (already-active, daily limit) say no.
        const runForLoopGuard = await db.supervisorRun.findUnique({
            where: { id: runId },
            select: { loopId: true },
        });
        void maybeAutoStartLoop({
            userId,
            projectId: id,
            runId,
            healthScore,
            runLoopId: runForLoopGuard?.loopId ?? null,
        }).catch((err) => {
            log(
                { module: "supervisor", level: "warn" },
                `D-1 auto-loop dispatch failed (run ${runId}): ${err}`,
            );
        });

        // Delayed re-aggregation: the turn-end cost report arrives AFTER
        // Claude's curl POST (which triggers this handler). Schedule
        // multiple retry attempts at increasing intervals.
        if (resolvedSessionId) {
            scheduleDelayedCostAggregation(runId, resolvedSessionId);
        }

        // Archive the supervisor session so it doesn't stay active
        if (resolvedSessionId) {
            const now = Date.now();
            await db.session.updateMany({
                where: { id: resolvedSessionId, active: true },
                data: { lastActiveAt: new Date(now), active: false },
            });
            activityCache.invalidateSession(resolvedSessionId);
            eventRouter.emitEphemeral({
                userId,
                payload: buildSessionActivityEphemeral(resolvedSessionId, false, now, false),
                recipientFilter: { type: "user-scoped-only" },
            });
        }
    }

    // Fetch the updated run for response
    const updated = await db.supervisorRun.findUnique({
        where: { id: runId },
    });

    // Notify App clients about status change
    eventRouter.emitEphemeral({
        userId,
        payload: buildSupervisorStatusEphemeral(
            runId,
            id,
            status,
            artifactId,
            errorMessage,
            currentDimension,
            dimensionIndex,
            totalDimensions,
        ),
        recipientFilter: { type: "user-scoped-only" },
    });

    // Notify the daemon so it can finalise its local AutomationJob.
    // The HTTP callback (Claude → Server) bypasses the daemon entirely,
    // so without this the AutomationScheduler stays stuck at "running".
    if ((status === "completed" || status === "failed") && machineId) {
        eventRouter.emitEphemeral({
            userId,
            payload: { type: "supervisor-run-complete", runId, projectId: id, status },
            recipientFilter: { type: "machine-scoped-only", machineId },
        });
    }

    if (status === "completed" || status === "failed") {
        // Inbox timeline entry for the terminal run (push is sent separately
        // below, so suppress the inbox's own push).
        const actionCount = reportedActions?.length ?? 0;
        void inboxCreate({
            accountId: userId,
            category: "supervisor",
            eventType: `supervisor.${status}`,
            severity: status === "failed"
                ? "error"
                : reportedActions?.some((a) => a.severity === "critical")
                    ? "warning"
                    : "info",
            title: status === "completed"
                ? `Supervisor: ${actionCount} issue(s) found`
                : "Supervisor run failed",
            body: status === "failed" ? (errorMessage ?? undefined) : undefined,
            referenceUrl: `/project/${id}/supervisor-run/${runId}`,
            refType: "supervisorRun",
            refId: runId,
            groupKey: `supervisor:${runId}:${status}`,
            skipPush: true,
        });

        if (status === "completed") {
            const criticalCount =
                reportedActions?.filter((a) => a.severity === "critical").length ?? 0;
            const highCount =
                reportedActions?.filter((a) => a.severity === "high").length ?? 0;
            const totalActions = reportedActions?.length ?? 0;
            const body =
                criticalCount > 0
                    ? `Found ${criticalCount} critical issue(s) requiring attention`
                    : totalActions > 0
                      ? `Found ${totalActions} issue(s) (${highCount} high priority)`
                      : "No issues found — project is healthy";
            await pushSupervisorNotification(userId, {
                projectId: id,
                runId,
                type: criticalCount > 0 ? "critical_finding" : "analysis_complete",
                title: "Supervisor Analysis Complete",
                body,
            });

            // Auto/semi-auto mode: automatically approve actions based on configured severities
            // Skip if run belongs to a loop — Loop engine handles its own approval flow.
            // Check DB for actions (not request body) because Claude may report
            // actions in a separate request from the "completed" status.
            const runForAutoApprove = await db.supervisorRun.findUnique({
                where: { id: runId },
                select: { loopId: true, actionsCount: true },
            });
            log(
                { module: "supervisor" },
                `Auto-approval check: run ${runId}, loopId=${runForAutoApprove?.loopId ?? "null"}, actionsCount=${runForAutoApprove?.actionsCount ?? "null"}`,
            );
            if (!runForAutoApprove?.loopId && (runForAutoApprove?.actionsCount ?? 0) > 0) {
                try {
                    await handleAutoApproval(userId, id, runId);
                } catch (autoApproveError) {
                    log(
                        { module: "supervisor", level: "error" },
                        `Auto-approval error for run ${runId}: ${autoApproveError}`,
                    );
                }
            }
        } else {
            await pushSupervisorNotification(userId, {
                projectId: id,
                runId,
                type: "error",
                title: "Supervisor Analysis Failed",
                body: errorMessage ?? "Analysis failed unexpectedly",
            });
        }

        // Loop progression: if this run belongs to a loop, advance the
        // state machine. Errors are absorbed inside the engine so they
        // never fail this status callback.
        await loopOnRunCompleted(userId, runId, id);
    }

    return { ok: true, run: updated };
}
