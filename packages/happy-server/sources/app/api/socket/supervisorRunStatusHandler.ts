/**
 * Handle supervisor-run-status events from CLI daemons.
 * Updates SupervisorRun records, creates SupervisorAction entries,
 * sends push notifications, and broadcasts status to App clients.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorStatusEphemeral,
    buildSupervisorTriggerEphemeral,
    buildSessionActivityEphemeral,
} from "@/app/events/eventRouter";
import { activityCache } from "@/app/presence/sessionCache";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { aggregateSessionUsage } from "@/modules/supervisorUsage";
import { createIssueOnProvider } from "@/app/webhook/webhookProviderApi";
import { decryptString } from "@/modules/encrypt";

const supervisorActionSchema = z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    category: z.string().max(50),
    title: z.string().max(500),
    description: z.string().max(2000),
    suggestedFix: z.string().max(2000).optional(),
    confidence: z.number().int().min(0).max(100).optional(),
});

const supervisorRunStatusSchema = z.object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    status: z.enum(["running", "completed", "failed"]),
    sessionId: z.string().min(1).optional(),
    actionsCount: z.number().int().min(0).optional(),
    issuesCreated: z.number().int().min(0).optional(),
    errorMessage: z.string().max(500).optional(),
    actions: z.array(supervisorActionSchema).max(20).optional(),
    tokenCount: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    currentDimension: z.string().max(50).optional(),
    dimensionIndex: z.number().int().min(1).optional(),
    totalDimensions: z.number().int().min(1).optional(),
});

export function supervisorRunStatusHandler(
    socket: Socket,
    userId: string,
): void {
    socket.on("supervisor-run-status", async (rawData: unknown) => {
        try {
            const parsed = supervisorRunStatusSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-run-status: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            const data = parsed.data;

            // Verify the run belongs to this user and is in an active state
            const run = await db.supervisorRun.findFirst({
                where: {
                    id: data.runId,
                    projectId: data.projectId,
                    accountId: userId,
                },
                select: { id: true, status: true },
            });

            if (!run) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-run-status: run ${data.runId} not found for user ${userId}`,
                );
                return;
            }

            // Only update if run is still in an active state
            if (run.status !== "pending" && run.status !== "running") {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-run-status: run ${data.runId} is already ${run.status}`,
                );
                return;
            }

            // Build update data
            const updateData: Record<string, unknown> = {
                status: data.status,
            };
            if (data.sessionId !== undefined)
                updateData.sessionId = data.sessionId;
            if (data.actionsCount !== undefined)
                updateData.actionsCount = data.actionsCount;
            if (data.issuesCreated !== undefined)
                updateData.issuesCreated = data.issuesCreated;
            if (data.errorMessage !== undefined)
                updateData.errorMessage = data.errorMessage;
            if (data.tokenCount !== undefined)
                updateData.tokenCount = data.tokenCount;
            if (data.costUsd !== undefined)
                updateData.costUsd = data.costUsd;
            if (data.status === "completed" || data.status === "failed") {
                updateData.completedAt = new Date();
            }

            // Update the run
            await db.supervisorRun.update({
                where: { id: data.runId },
                data: updateData,
            });

            // Create SupervisorAction entries if provided — with deduplication
            if (data.actions && data.actions.length > 0) {
                // Find existing pending actions with matching category+title
                const existingPending = await db.supervisorAction.findMany({
                    where: {
                        projectId: data.projectId,
                        accountId: userId,
                        approval: "pending",
                    },
                    select: {
                        id: true,
                        category: true,
                        title: true,
                    },
                });

                const existingKeys = new Map(
                    existingPending.map((a) => [`${a.category}::${a.title}`, a.id]),
                );

                const newActions: typeof data.actions = [];
                const updatedIds: string[] = [];

                for (const action of data.actions) {
                    const key = `${action.category}::${action.title}`;
                    const existingId = existingKeys.get(key);
                    if (existingId) {
                        // Update existing pending action with latest data
                        await db.supervisorAction.update({
                            where: { id: existingId },
                            data: {
                                lastSeenRunId: data.runId,
                                description: action.description,
                                suggestedFix: action.suggestedFix ?? null,
                                confidence: action.confidence ?? null,
                                severity: action.severity,
                            },
                        });
                        updatedIds.push(existingId);
                    } else {
                        newActions.push(action);
                    }
                }

                // Create only genuinely new actions
                if (newActions.length > 0) {
                    await db.supervisorAction.createMany({
                        data: newActions.map((action) => ({
                            runId: data.runId,
                            projectId: data.projectId,
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

                // Update actionsCount to reflect total findings (new + deduped)
                await db.supervisorRun.update({
                    where: { id: data.runId },
                    data: { actionsCount: data.actions.length },
                });

                log(
                    { module: "supervisor" },
                    `supervisor-run-status: ${newActions.length} new actions, ${updatedIds.length} deduped`,
                );
            }

            log(
                { module: "supervisor" },
                `supervisor-run-status: run ${data.runId} → ${data.status}${data.actions ? ` (${data.actions.length} actions)` : ""}`,
            );

            // Aggregate session usage (cost/tokens) on completion
            if (data.status === "completed") {
                const sessionId = data.sessionId;
                let resolvedSessionId = sessionId;
                if (!resolvedSessionId) {
                    const existingRun = await db.supervisorRun.findUnique({
                        where: { id: data.runId },
                        select: { sessionId: true },
                    });
                    resolvedSessionId = existingRun?.sessionId ?? undefined;
                }
                const usage = await aggregateSessionUsage(resolvedSessionId);
                if (usage) {
                    await db.supervisorRun.update({
                        where: { id: data.runId },
                        data: {
                            tokenCount: usage.totalTokens,
                            costUsd: usage.totalCostUsd,
                        },
                    });
                }

                // Delayed re-aggregation: turn-end cost report may arrive after
                // the completion event. Re-aggregate after 10s to capture actual cost.
                if (resolvedSessionId) {
                    const capturedRunId = data.runId;
                    setTimeout(async () => {
                        try {
                            const delayed = await aggregateSessionUsage(resolvedSessionId);
                            if (delayed && delayed.totalCostUsd > 0) {
                                await db.supervisorRun.update({
                                    where: { id: capturedRunId },
                                    data: {
                                        tokenCount: delayed.totalTokens,
                                        costUsd: delayed.totalCostUsd,
                                    },
                                });
                            }
                        } catch {
                            // best-effort
                        }
                    }, 10_000);
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

            // Notify App clients about status change
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorStatusEphemeral(
                    data.runId,
                    data.projectId,
                    data.status,
                    undefined,
                    data.errorMessage,
                    data.currentDimension,
                    data.dimensionIndex,
                    data.totalDimensions,
                ),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Send push notification on completion/failure
            if (data.status === "completed" || data.status === "failed") {
                const criticalCount =
                    data.actions?.filter(
                        (a) => a.severity === "critical",
                    ).length ?? 0;
                const highCount =
                    data.actions?.filter((a) => a.severity === "high")
                        .length ?? 0;

                if (data.status === "completed") {
                    const totalActions = data.actions?.length ?? 0;
                    const body =
                        criticalCount > 0
                            ? `Found ${criticalCount} critical issue(s) requiring attention`
                            : totalActions > 0
                              ? `Found ${totalActions} issue(s) (${highCount} high priority)`
                              : "No issues found — project is healthy";

                    await pushSupervisorNotification(userId, {
                        projectId: data.projectId,
                        runId: data.runId,
                        type:
                            criticalCount > 0
                                ? "critical_finding"
                                : "analysis_complete",
                        title: "Supervisor Analysis Complete",
                        body,
                    });

                    // Auto mode: automatically approve critical/high actions and trigger fixes
                    if (
                        data.actions &&
                        data.actions.length > 0 &&
                        (criticalCount > 0 || highCount > 0)
                    ) {
                        await handleAutoMode(
                            userId,
                            data.projectId,
                            data.runId,
                        );
                    }
                } else {
                    await pushSupervisorNotification(userId, {
                        projectId: data.projectId,
                        runId: data.runId,
                        type: "error",
                        title: "Supervisor Analysis Failed",
                        body:
                            data.errorMessage ??
                            "Analysis failed unexpectedly",
                    });
                }
            }
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `supervisor-run-status handler error: ${error}`,
            );
        }
    });
}

/**
 * In auto mode, automatically approve critical/high severity actions
 * and trigger fix sessions for them.
 *
 * IMPORTANT: PR merge ALWAYS requires human confirmation — this is a
 * hardcoded constraint, not a configuration option. Auto mode only
 * triggers fix sessions (which create PRs), it never merges them.
 */
async function handleAutoMode(
    userId: string,
    projectId: string,
    runId: string,
): Promise<void> {
    try {
        // Check if project is in auto mode
        const project = await db.project.findUnique({
            where: { id: projectId },
            select: {
                supervisorMode: true,
                machineId: true,
                path: true,
                repoUrl: true,
                fixStrategy: true,
            },
        });

        if (!project || project.supervisorMode !== "auto") return;

        // Find critical/high pending actions from this run
        const actions = await db.supervisorAction.findMany({
            where: {
                runId,
                projectId,
                accountId: userId,
                approval: "pending",
                severity: { in: ["critical", "high"] },
            },
            select: {
                id: true,
                severity: true,
                title: true,
                description: true,
                suggestedFix: true,
                category: true,
            },
        });

        if (actions.length === 0) return;

        // Auto-approve all critical/high actions
        await db.supervisorAction.updateMany({
            where: {
                id: { in: actions.map((a) => a.id) },
                approval: "pending",
            },
            data: {
                approval: "approved",
                fixStatus: "pending",
            },
        });

        log(
            { module: "supervisor" },
            `Auto mode: approved ${actions.length} critical/high actions for project ${projectId}`,
        );

        // Find WebhookRoute for issue creation (best-effort)
        let webhookRoute: {
            apiToken: Uint8Array<ArrayBuffer> | null;
            provider: string;
            repoUrl: string;
        } | null = null;
        if (project.repoUrl) {
            webhookRoute = await db.webhookRoute.findFirst({
                where: {
                    accountId: userId,
                    repoUrl: project.repoUrl,
                    enabled: true,
                },
                select: { apiToken: true, provider: true, repoUrl: true },
            });
        }

        // Decrypt API token once for all actions
        let decryptedApiToken: string | undefined;
        if (webhookRoute?.apiToken) {
            try {
                decryptedApiToken = decryptString(
                    ["webhook-route-token", `${userId}:${webhookRoute.repoUrl}`],
                    webhookRoute.apiToken as unknown as Uint8Array<ArrayBuffer>,
                );
            } catch {
                log(
                    { module: "supervisor", level: "warn" },
                    `Auto mode: failed to decrypt API token for ${webhookRoute.repoUrl}`,
                );
            }
        }

        // Trigger fix for each approved action
        for (const action of actions) {
            // Create Issue on provider for tracking (best-effort)
            let issueNumber: number | undefined;
            if (webhookRoute && decryptedApiToken) {
                const issueResult = await createIssueOnProvider(
                    webhookRoute.provider,
                    webhookRoute.repoUrl,
                    decryptedApiToken,
                    `[Supervisor] ${action.title}`,
                    buildAutoModeIssueBody(action),
                    ["supervisor"],
                );
                if (issueResult) {
                    issueNumber = issueResult.issueNumber;
                    await db.supervisorAction.update({
                        where: { id: action.id },
                        data: { issueUrl: issueResult.issueUrl },
                    });
                    log(
                        { module: "supervisor" },
                        `Auto mode: created issue #${issueResult.issueNumber} for action ${action.id}`,
                    );
                }
            }

            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorTriggerEphemeral(
                    projectId,
                    action.id, // Use actionId as the runId for fix sessions
                    "fix",
                    project.machineId,
                    project.path,
                    "auto",
                    undefined, // dimensions
                    undefined, // changedFiles
                    undefined, // customRules
                    {
                        title: action.title,
                        description: action.description,
                        suggestedFix: action.suggestedFix,
                        category: action.category,
                        severity: action.severity,
                        issueNumber,
                    },
                    undefined, // researchParams
                    project.fixStrategy ?? undefined,
                ),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: project.machineId,
                },
            });
        }

        // Send push notification about auto-triggered fixes
        await pushSupervisorNotification(userId, {
            projectId,
            runId,
            type: "fix_complete",
            title: "Auto Fix Triggered",
            body: `Automatically triggered fixes for ${actions.length} critical/high finding(s)`,
        });
    } catch (error) {
        log(
            { module: "supervisor", level: "error" },
            `Auto mode handler error for project ${projectId}: ${error}`,
        );
    }
}

function buildAutoModeIssueBody(action: {
    readonly severity: string;
    readonly category: string;
    readonly description: string;
    readonly suggestedFix: string | null;
}): string {
    const parts = [
        `**Severity**: ${action.severity}`,
        `**Category**: ${action.category}`,
        "",
        action.description,
    ];
    if (action.suggestedFix) {
        parts.push("", "**Suggested Fix**:", action.suggestedFix);
    }
    parts.push("", "---", "*Auto-created by Happy Supervisor*");
    return parts.join("\n");
}
