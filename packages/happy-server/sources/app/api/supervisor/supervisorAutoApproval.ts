/**
 * Auto/semi-auto approval for supervisor findings.
 *
 * When a project is in `auto` or `semi-auto` mode, a completed run's findings
 * that match the configured severities are approved without human action and
 * a fix session is triggered for each. Extracted from the run-status callback
 * so both the daemon socket and the curl HTTP transports drive the exact same
 * approval flow through `supervisorRunStatusApply`, and so it can be tested in
 * isolation.
 *
 * IMPORTANT: PR merge ALWAYS requires human confirmation — this is a hardcoded
 * constraint, not a configuration option. This function only triggers fix
 * sessions (which create PRs), it never merges them.
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { createIssueOnProvider } from "@/app/webhook/webhookProviderApi";
import { parseAutoApproveSeverities } from "@/modules/supervisorConfig";
import { decryptString } from "@/modules/encrypt";
import { emitConfiguredSupervisorFixTrigger } from "@/modules/supervisorFixTrigger";
import { decideAutoApproveAndQueueFix } from "@/modules/supervisorFixStatusLogic";

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

        // Batch-approve matching actions per configured severities — the
        // approve-and-queue transition (and its CAS guard) is owned by
        // decideAutoApproveAndQueueFix, shared with the loop engine.
        const autoApprove = decideAutoApproveAndQueueFix();
        await db.supervisorAction.updateMany({
            where: {
                id: { in: actions.map((a) => a.id) },
                approval: autoApprove.allowedFrom,
            },
            data: autoApprove.data,
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

            await emitConfiguredSupervisorFixTrigger({
                userId,
                projectId,
                actionId: action.id,
                machineId: project.machineId,
                repoPath: project.path,
                supervisorConfig: project.supervisorConfig,
                fixStrategy: project.fixStrategy,
                mode,
                maxConcurrentAnalysis,
                maxConcurrentFix,
                fixAction: {
                    title: action.title,
                    description: action.description,
                    suggestedFix: action.suggestedFix,
                    category: action.category,
                    severity: action.severity,
                    issueNumber,
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
