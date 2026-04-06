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
import { aggregateSessionUsage, scheduleDelayedCostAggregation } from "@/modules/supervisorUsage";
import { createIssueOnProvider } from "@/app/webhook/webhookProviderApi";
import { parseAutoApproveSeverities } from "@/modules/supervisorConfig";
import { decryptString } from "@/modules/encrypt";
import { onRunCompleted as loopOnRunCompleted } from "@/modules/supervisorLoopEngine";
import { contributeSupervisorKnowledge } from "@/modules/knowledgeContributor";
import { inboxCreate } from "@/modules/inboxCreate";

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
                select: { id: true, status: true, loopId: true },
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
            // Skip = temporary dismiss, resurfaces on next scan
            // Ignore = permanent dismiss, suppressed on next scan
            if (data.actions && data.actions.length > 0) {
                // Find existing actions with matching category+title (any approval state)
                const existingActions = await db.supervisorAction.findMany({
                    where: {
                        projectId: data.projectId,
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

                // Build lookup: category::title → { id, approval }
                // If multiple exist for same key, prefer pending > skipped > ignored
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

                const newActions: typeof data.actions = [];
                const updatedIds: string[] = [];
                const restoredIds: string[] = [];
                const suppressedIds: string[] = [];

                // Collect batch updates to avoid N+1 DB writes
                const batchOps: ReturnType<typeof db.supervisorAction.update>[] = [];

                for (const action of data.actions) {
                    const key = `${action.category}::${action.title}`;
                    const existing = existingKeys.get(key);
                    if (!existing) {
                        newActions.push(action);
                    } else if (existing.approval === "pending") {
                        // Update existing pending action with latest data
                        batchOps.push(
                            db.supervisorAction.update({
                                where: { id: existing.id },
                                data: {
                                    lastSeenRunId: data.runId,
                                    description: action.description,
                                    suggestedFix: action.suggestedFix ?? null,
                                    confidence: action.confidence ?? null,
                                    severity: action.severity,
                                },
                            }),
                        );
                        updatedIds.push(existing.id);
                    } else if (existing.approval === "skipped") {
                        // Restore skipped action back to pending
                        batchOps.push(
                            db.supervisorAction.update({
                                where: { id: existing.id },
                                data: {
                                    approval: "pending",
                                    lastSeenRunId: data.runId,
                                    description: action.description,
                                    suggestedFix: action.suggestedFix ?? null,
                                    confidence: action.confidence ?? null,
                                    severity: action.severity,
                                },
                            }),
                        );
                        restoredIds.push(existing.id);
                    } else if (existing.approval === "ignored") {
                        // Suppress: only update lastSeenRunId, don't change approval
                        batchOps.push(
                            db.supervisorAction.update({
                                where: { id: existing.id },
                                data: { lastSeenRunId: data.runId },
                            }),
                        );
                        suppressedIds.push(existing.id);
                    }
                }

                // Execute all dedup updates in a single transaction
                if (batchOps.length > 0) {
                    await db.$transaction(batchOps);
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
                    `supervisor-run-status: ${newActions.length} new, ${updatedIds.length} deduped, ${restoredIds.length} restored from skip, ${suppressedIds.length} suppressed by ignore`,
                );

                // Contribute supervisor findings to knowledge base (only on terminal status)
                if (data.status === "completed") {
                    void contributeSupervisorKnowledge(data.projectId, data.runId, data.actions);
                }
            }

            log(
                { module: "supervisor" },
                `supervisor-run-status: run ${data.runId} → ${data.status}${data.actions ? ` (${data.actions.length} actions)` : ""}`,
            );

            // Inbox notification for terminal supervisor runs
            if (data.status === "completed" || data.status === "failed") {
                const actionCount = data.actions?.length ?? 0;
                void inboxCreate({
                    accountId: userId,
                    category: "supervisor",
                    eventType: `supervisor.${data.status}`,
                    severity: data.status === "failed"
                        ? "error"
                        : data.actions?.some((a) => a.severity === "critical")
                            ? "warning"
                            : "info",
                    title: data.status === "completed"
                        ? `Supervisor: ${actionCount} issue(s) found`
                        : "Supervisor run failed",
                    body: data.status === "failed" ? (data.errorMessage ?? undefined) : undefined,
                    referenceUrl: `/project/${data.projectId}/supervisor-run/${data.runId}`,
                    refType: "supervisorRun",
                    refId: data.runId,
                    groupKey: `supervisor:${data.runId}:${data.status}`,
                    skipPush: true, // Supervisor already sends its own push
                });
            }

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
                // the completion event. Schedule multiple retry attempts.
                if (resolvedSessionId) {
                    scheduleDelayedCostAggregation(data.runId, resolvedSessionId);
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

                    // Auto/semi-auto mode: automatically approve actions based on configured severities
                    // Skip if run belongs to a Loop — Loop engine handles its own approval flow
                    if (
                        !run.loopId &&
                        data.actions &&
                        data.actions.length > 0
                    ) {
                        await handleAutoApproval(
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

                // Loop progression: if this run belongs to a loop, advance the state machine
                try {
                    await loopOnRunCompleted(userId, data.runId, data.projectId);
                } catch (loopError) {
                    log(
                        { module: "supervisor", level: "error" },
                        `Loop progression error for run ${data.runId}: ${loopError}`,
                    );
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
 * Automatically approve actions based on configured severity levels
 * for semi-auto and auto modes, then trigger fix sessions.
 *
 * IMPORTANT: PR merge ALWAYS requires human confirmation — this is a
 * hardcoded constraint, not a configuration option. This function only
 * triggers fix sessions (which create PRs), it never merges them.
 */
export async function handleAutoApproval(
    userId: string,
    projectId: string,
    runId: string,
): Promise<void> {
    try {
        const project = await db.project.findUnique({
            where: { id: projectId },
            select: {
                supervisorMode: true,
                machineId: true,
                path: true,
                repoUrl: true,
                fixStrategy: true,
                supervisorConfig: true,
            },
        });

        if (!project) {
            log({ module: "supervisor" }, `handleAutoApproval: project ${projectId} not found`);
            return;
        }
        const mode = project.supervisorMode;
        if (mode !== "auto" && mode !== "semi-auto") {
            log({ module: "supervisor" }, `handleAutoApproval: mode=${mode}, skipping`);
            return;
        }

        // Get configured severity levels for auto-approval
        const severities = parseAutoApproveSeverities(
            project.supervisorConfig,
            mode as "semi-auto" | "auto",
        );
        log({ module: "supervisor" }, `handleAutoApproval: mode=${mode}, severities=[${severities}], runId=${runId}`);
        if (severities.length === 0) return;

        // Find pending actions from this run matching configured severities
        const actions = await db.supervisorAction.findMany({
            where: {
                runId,
                projectId,
                accountId: userId,
                approval: "pending",
                severity: { in: severities },
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

        // Batch-approve matching actions per configured severities
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
            `${mode} mode: approved ${actions.length} actions (severities: ${severities.join(",")}) for project ${projectId}`,
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
                    `${mode} mode: failed to decrypt API token for ${webhookRoute.repoUrl}`,
                );
            }
        }

        // Parse supervisor config once before the loop
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedSupervisorConfig: any;
        if (project.supervisorConfig) {
            try {
                parsedSupervisorConfig = JSON.parse(project.supervisorConfig);
            } catch { /* ignore */ }
        }

        // Trigger fix for each approved action
        log({ module: "supervisor" }, `handleAutoApproval: triggering ${actions.length} fix events for project ${projectId}`);
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
                        `${mode} mode: created issue #${issueResult.issueNumber} for action ${action.id}`,
                    );
                }
            }

            // Extract concurrency limits from pre-parsed project config
            let maxConcurrentAnalysis: number | undefined;
            let maxConcurrentFix: number | undefined;
            if (parsedSupervisorConfig) {
                const c = parsedSupervisorConfig?.concurrency;
                if (c && typeof c === "object") {
                    maxConcurrentAnalysis = typeof c.maxAnalysisSessions === "number" ? c.maxAnalysisSessions : undefined;
                    maxConcurrentFix = typeof c.maxFixSessions === "number" ? c.maxFixSessions : undefined;
                }
            }

            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorTriggerEphemeral({
                    projectId,
                    runId: action.id, // Use actionId as the runId for fix sessions
                    trigger: "fix",
                    machineId: project.machineId,
                    repoPath: project.path,
                    mode,
                    fixAction: {
                        title: action.title,
                        description: action.description,
                        suggestedFix: action.suggestedFix,
                        category: action.category,
                        severity: action.severity,
                        issueNumber,
                    },
                    fixStrategy: project.fixStrategy ?? undefined,
                    maxConcurrentAnalysis,
                    maxConcurrentFix,
                }),
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
            title: mode === "auto" ? "Auto Fix Triggered" : "Semi-Auto Fix Triggered",
            body: `Automatically triggered fixes for ${actions.length} action(s) (${severities.join(", ")})`,
        });
    } catch (error) {
        log(
            { module: "supervisor", level: "error" },
            `Auto-approval handler error for project ${projectId}: ${error}`,
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
