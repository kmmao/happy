import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { onFixCompleted as loopOnFixCompleted } from "@/modules/supervisorLoopEngine";
import { emitConfiguredSupervisorFixTrigger, buildFixActionTriggerInput } from "@/modules/supervisorFixTrigger";
import { parseSupervisorConfig } from "@/modules/supervisorConfig";
import { sessionDeactivate } from "@/app/session/sessionDeactivate";
import {
    decideApprovalTransition,
    DISMISSED_APPROVALS,
} from "@/modules/supervisorActionLogic";
import {
    ACTIVE_FIX_STATUSES,
    canTriggerFix,
    decideFixStatusReport,
    supervisorActionViewFilter,
    isUpdatedAtOrderedView,
    type SupervisorFixStatus,
    type TerminalFixStatus,
} from "@/modules/supervisorFixStatusLogic";
import { assertOwnedProject } from "../ownership";

/**
 * Supervisor action routes for the approval workflow.
 * List, approve/skip/ignore actions, and trigger fix sessions.
 */
export function supervisorActionRoutes(app: Fastify) {
    // GET /v1/projects/:id/supervisor/actions — List actions for a project
    app.get(
        "/v1/projects/:id/supervisor/actions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z
                    .object({
                        approval: z
                            .enum(["pending", "approved", "skipped", "ignored"])
                            .optional(),
                        view: z
                            .enum(["approved", "fixing", "analyzing", "analyzed", "done", "failed", "dismissed"])
                            .optional(),
                        category: z.string().optional(),
                        runId: z.string().optional(),
                        limit: z.coerce
                            .number()
                            .int()
                            .min(1)
                            .max(100)
                            .default(50),
                        offset: z.coerce.number().int().min(0).default(0),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const approval = request.query?.approval;
            const view = request.query?.view;
            const category = request.query?.category;
            const runId = request.query?.runId;
            const limit = request.query?.limit ?? 50;
            const offset = request.query?.offset ?? 0;

            await assertOwnedProject(userId, id);

            const where: Record<string, unknown> = {
                projectId: id,
                accountId: userId,
            };
            if (runId) where.runId = runId;
            if (category) where.category = category;

            // view takes precedence over approval. The view → filter mapping
            // (and its fixing/analyzing fixMode split) is owned by
            // supervisorActionViewFilter — do not re-derive it here.
            if (view) {
                Object.assign(where, supervisorActionViewFilter(view));
            } else if (approval) {
                where.approval = approval;
            }

            // Sort by updatedAt for fix-progress views (latest status change first)
            const orderBy = isUpdatedAtOrderedView(view)
                ? { updatedAt: "desc" as const }
                : { createdAt: "desc" as const };

            const [actions, total] = await Promise.all([
                db.supervisorAction.findMany({
                    where,
                    orderBy,
                    take: limit,
                    skip: offset,
                }),
                db.supervisorAction.count({ where }),
            ]);

            return reply.send({
                actions: actions.map(serializeSupervisorAction),
                total,
            });
        },
    );

    // PATCH /v1/projects/:id/supervisor/actions/:actionId — Update action approval
    app.patch(
        "/v1/projects/:id/supervisor/actions/:actionId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    actionId: z.string(),
                }),
                body: z.object({
                    approval: z.enum(["approved", "skipped", "ignored", "pending"]),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, actionId } = request.params;
            const { approval } = request.body;

            // The approval state machine and its interlock with the fix
            // lifecycle live in decideApprovalTransition. The decision is applied
            // as ONE atomic updateMany (compare-and-swap on allowedFrom) so the
            // transition stays race-safe.
            const transition = decideApprovalTransition(approval);

            const result = await db.supervisorAction.updateMany({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: { in: transition.allowedFrom },
                    // Prisma: notIn does not match NULL, so explicitly allow null
                    ...(transition.blockWhileActivelyFixing
                        ? { OR: [{ fixStatus: null }, { fixStatus: { notIn: [...ACTIVE_FIX_STATUSES] } }] }
                        : {}),
                },
                data: {
                    approval,
                    ...(transition.resetFix
                        ? { fixStatus: null, fixSessionId: null, fixMode: null }
                        : {}),
                },
            });

            if (result.count === 0) {
                return reply.code(404).send({
                    error: "Action not found or invalid state transition",
                });
            }

            const updated = await db.supervisorAction.findUnique({
                where: { id: actionId },
            });

            return reply.send({
                action: updated ? serializeSupervisorAction(updated) : null,
            });
        },
    );

    // POST /v1/projects/:id/supervisor/actions/batch — Batch approve/skip/ignore actions
    app.post(
        "/v1/projects/:id/supervisor/actions/batch",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    actionIds: z.array(z.string()).min(1).max(50),
                    approval: z.enum(["approved", "skipped", "ignored"]),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { actionIds, approval } = request.body;

            await assertOwnedProject(userId, id);

            const result = await db.supervisorAction.updateMany({
                where: {
                    id: { in: actionIds },
                    projectId: id,
                    accountId: userId,
                    approval: "pending",
                },
                data: { approval },
            });

            return reply.send({ updatedCount: result.count });
        },
    );

    // DELETE /v1/projects/:id/supervisor/actions — Clear all actions for a project
    app.delete(
        "/v1/projects/:id/supervisor/actions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            await assertOwnedProject(userId, id);

            const result = await db.supervisorAction.deleteMany({
                where: {
                    projectId: id,
                    accountId: userId,
                },
            });

            return reply.send({ deletedCount: result.count });
        },
    );

    // DELETE /v1/projects/:id/supervisor/actions/:actionId — Delete a single action
    app.delete(
        "/v1/projects/:id/supervisor/actions/:actionId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    actionId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, actionId } = request.params;

            const result = await db.supervisorAction.deleteMany({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: { in: [...DISMISSED_APPROVALS] },
                },
            });

            if (result.count === 0) {
                return reply.code(404).send({ error: "Action not found" });
            }

            return reply.send({ deleted: true });
        },
    );

    // GET /v1/projects/:id/supervisor/actions/stats — Action approval and fix status counts
    app.get(
        "/v1/projects/:id/supervisor/actions/stats",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            await assertOwnedProject(userId, id);

            const [approvalGroups, fixGroups] = await Promise.all([
                db.supervisorAction.groupBy({
                    by: ["approval"],
                    where: { projectId: id, accountId: userId },
                    _count: { _all: true },
                }),
                db.supervisorAction.groupBy({
                    by: ["fixStatus"],
                    where: {
                        projectId: id,
                        accountId: userId,
                        approval: "approved",
                    },
                    _count: { _all: true },
                }),
            ]);

            // Count analyzing actions separately (safe fallback if fixMode column doesn't exist yet)
            let analyzingCount = 0;
            try {
                analyzingCount = await db.supervisorAction.count({
                    where: {
                        projectId: id,
                        accountId: userId,
                        approval: "approved",
                        fixMode: "analyze-first",
                        fixStatus: { in: [...ACTIVE_FIX_STATUSES] },
                    },
                });
            } catch {
                // fixMode column may not exist yet — gracefully default to 0
            }

            const approvalMap: Record<string, number> = {};
            for (const row of approvalGroups) {
                approvalMap[row.approval] = row._count._all;
            }

            const fixMap: Record<string, number> = {};
            for (const row of fixGroups) {
                const key = row.fixStatus ?? "none";
                fixMap[key] = row._count._all;
            }

            // fixPending/fixRunning include both fix and analyze modes;
            // subtract analyzing count for pure fix stats
            const totalInProgress = (fixMap["pending"] ?? 0) + (fixMap["running"] ?? 0);

            return reply.send({
                pending: approvalMap["pending"] ?? 0,
                approved: approvalMap["approved"] ?? 0,
                skipped: approvalMap["skipped"] ?? 0,
                ignored: approvalMap["ignored"] ?? 0,
                approvedNoFix: fixMap["none"] ?? 0,
                fixPending: fixMap["pending"] ?? 0,
                fixRunning: fixMap["running"] ?? 0,
                fixCompleted: fixMap["completed"] ?? 0,
                fixFailed: fixMap["failed"] ?? 0,
                fixAnalyzed: fixMap["analyzed"] ?? 0,
                analyzing: analyzingCount,
                fixing: totalInProgress - analyzingCount,
            });
        },
    );

    // POST /v1/projects/:id/supervisor/actions/:actionId/fix — Trigger a fix session
    app.post(
        "/v1/projects/:id/supervisor/actions/:actionId/fix",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    actionId: z.string(),
                }),
                body: z
                    .object({
                        machineId: z.string().optional(),
                        repoPath: z.string().optional(),
                        mode: z.enum(["fix", "analyze-first"]).optional(),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, actionId } = request.params;

            // Verify the action exists and is approved
            const action = await db.supervisorAction.findFirst({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: "approved",
                },
            });

            if (!action) {
                return reply.code(404).send({
                    error: "Approved action not found",
                });
            }

            // Don't re-trigger if fix is already in progress
            if (!canTriggerFix(action.fixStatus as SupervisorFixStatus | null)) {
                return reply.code(409).send({
                    error: "Fix is already in progress",
                });
            }

            // Get project for machine/path info + config
            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: {
                    id: true,
                    machineId: true,
                    path: true,
                    fixStrategy: true,
                    supervisorConfig: true,
                },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const fixMode = request.body?.mode ?? "fix";

            // Read analyzeAutoFix from project config
            const analyzeAutoFix =
                fixMode === "analyze-first" &&
                parseSupervisorConfig(project.supervisorConfig).analyzeAutoFix;

            // Update fix status to pending and store fixMode
            await db.supervisorAction.update({
                where: { id: actionId },
                data: { fixStatus: "pending", fixMode },
            });

            const machineId =
                request.body?.machineId || project.machineId;
            const repoPath = request.body?.repoPath || project.path;

            await emitConfiguredSupervisorFixTrigger({
                userId,
                projectId: id,
                actionId,
                machineId,
                repoPath,
                supervisorConfig: project.supervisorConfig,
                fixStrategy: project.fixStrategy,
                fixMode,
                analyzeAutoFix,
                fixAction: buildFixActionTriggerInput(action),
            });

            return reply.send({
                action: serializeSupervisorAction({
                    ...action,
                    fixStatus: "pending",
                }),
            });
        },
    );

    // PATCH /v1/projects/:id/supervisor/actions/:actionId/fix-status — CLI callback for fix progress
    app.patch(
        "/v1/projects/:id/supervisor/actions/:actionId/fix-status",
        {
            preHandler: app.authenticateMachineScopedCallback,
            schema: {
                params: z.object({
                    id: z.string(),
                    actionId: z.string(),
                }),
                body: z.object({
                    fixStatus: z.enum([
                        "running",
                        "completed",
                        "failed",
                        "analyzed",
                    ]),
                    fixSessionId: z.string().optional(),
                    issueUrl: z.string().url().optional(),
                }),
            },
        },
        async (request, reply) => {
            const callbackAuth = request.supervisorCallbackAuth;
            const { id, actionId } = request.params;
            if (!callbackAuth || callbackAuth.purpose !== "fix-status" || callbackAuth.projectId !== id || callbackAuth.actionId !== actionId) {
                return reply.code(403).send({ error: "Callback token mismatch" });
            }

            const userId = callbackAuth.userId;
            const machineId = callbackAuth.machineId;
            const { fixStatus, fixSessionId, issueUrl } = request.body;

            const action = await db.supervisorAction.findFirst({

                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: "approved",
                },
                select: {
                    id: true,
                    runId: true,
                    title: true,
                    fixSessionId: true,
                },
            });

            if (!action) {
                return reply.code(404).send({
                    error: "Approved action not found",
                });
            }

            const project = await db.project.findFirst({
                where: {
                    id,
                    accountId: userId,
                },
                select: {
                    machineId: true,
                },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            if (!machineId || project.machineId !== machineId) {
                return reply.code(403).send({ error: "Machine mismatch" });
            }

            if (fixSessionId) {
                const matchedSession = await db.session.findFirst({
                    where: {
                        id: fixSessionId,
                        accountId: userId,
                        projectId: id,
                    },
                    select: { id: true },
                });
                if (!matchedSession) {
                    return reply.code(403).send({ error: "Invalid fix session for machine" });
                }
            }

            const data: Record<string, unknown> = { fixStatus };
            if (fixSessionId !== undefined) data.fixSessionId = fixSessionId;
            if (issueUrl !== undefined) data.issueUrl = issueUrl;

            const result = await db.supervisorAction.updateMany({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: "approved",
                },
                data,
            });

            if (result.count === 0) {
                return reply.code(404).send({
                    error: "Approved action not found",
                });
            }

            const updated = await db.supervisorAction.findUnique({
                where: { id: actionId },
            });

            // Notify App clients about fix status change (mirrors socket handler).
            if (updated) {
                await emitSyncEphemeral(userId, {
                    t: "supervisor-status",
                    runId: updated.runId,
                    projectId: id,
                    status: `fix-${fixStatus}`,
                });
            }

            // Everything that follows from a fix-status report (kill? notify?
            // progress the loop?) is decided in one place shared with the
            // socket transport — decideFixStatusReport.
            const report = decideFixStatusReport(fixStatus, updated?.title ?? "");

            // On terminal statuses: tell CLI daemon to kill the fix session
            if (report.requestSessionKill && updated?.fixSessionId) {
                const project = await db.project.findUnique({
                    where: { id },
                    select: { machineId: true },
                });

                if (project?.machineId) {
                    await emitSyncEphemeral(userId, {
                        t: "supervisor-fix-kill-session",
                        fixSessionId: updated.fixSessionId,
                        projectId: id,
                        fixStatus,
                        machineId: project.machineId,
                    });
                }

                // Send push notification
                if (report.notification) {
                    await pushSupervisorNotification(userId, {
                        projectId: id,
                        runId: updated.runId,
                        type: report.notification.type,
                        title: report.notification.title,
                        body: report.notification.body,
                    });
                }
            }

            // Loop progression: if this fix belongs to a loop, check if all fixes
            // are done. The engine absorbs its own errors.
            if (report.progressLoop) {
                await loopOnFixCompleted(userId, actionId, id, fixStatus as TerminalFixStatus);
            }

            return reply.send({
                action: updated ? serializeSupervisorAction(updated) : null,
            });
        },
    );

    // POST /v1/projects/:id/supervisor/actions/:actionId/force-resolve — Manual override for stuck fix status
    app.post(
        "/v1/projects/:id/supervisor/actions/:actionId/force-resolve",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    actionId: z.string(),
                }),
                body: z.object({
                    resolution: z.enum(["completed", "failed"]),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, actionId } = request.params;
            const { resolution } = request.body;

            // Verify action exists and belongs to this user
            const action = await db.supervisorAction.findFirst({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: "approved",
                    fixStatus: { in: [...ACTIVE_FIX_STATUSES] },
                },
                select: { id: true, fixSessionId: true, runId: true, title: true },
            });

            if (!action) {
                return reply.code(404).send({
                    error: "Action not found or not in a fixable state",
                });
            }

            // Update fix status
            await db.supervisorAction.update({
                where: { id: actionId },
                data: { fixStatus: resolution },
            });

            // Archive fix session if present
            if (action.fixSessionId) {
                await sessionDeactivate(userId, action.fixSessionId);

                // Tell CLI daemon to kill the session
                const project = await db.project.findUnique({
                    where: { id },
                    select: { machineId: true },
                });

                if (project?.machineId) {
                    await emitSyncEphemeral(userId, {
                        t: "supervisor-fix-kill-session",
                        fixSessionId: action.fixSessionId,
                        projectId: id,
                        fixStatus: resolution,
                        machineId: project.machineId,
                    });
                }
            }

            // Notify App clients.
            await emitSyncEphemeral(userId, {
                t: "supervisor-status",
                runId: action.runId,
                projectId: id,
                status: `fix-${resolution}`,
            });

            // Send push notification
            const title = resolution === "completed"
                ? "Fix Manually Resolved"
                : "Fix Manually Failed";
            const body = resolution === "completed"
                ? `Resolved: ${action.title}`
                : `Marked failed: ${action.title}`;
            await pushSupervisorNotification(userId, {
                projectId: id,
                runId: action.runId,
                type: resolution === "completed" ? "fix_complete" : "error",
                title,
                body,
            });

            // Loop progression — the engine absorbs its own errors.
            await loopOnFixCompleted(userId, actionId, id, resolution);

            const updated = await db.supervisorAction.findUnique({
                where: { id: actionId },
            });

            return reply.send({
                action: updated ? serializeSupervisorAction(updated) : null,
            });
        },
    );
}

function serializeSupervisorAction(action: {
    id: string;
    runId: string;
    projectId: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    suggestedFix: string | null;
    confidence: number | null;
    approval: string;
    fixSessionId: string | null;
    fixStatus: string | null;
    fixMode: string | null;
    issueUrl: string | null;
    lastSeenRunId: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: action.id,
        runId: action.runId,
        projectId: action.projectId,
        severity: action.severity,
        category: action.category,
        title: action.title,
        description: action.description,
        suggestedFix: action.suggestedFix,
        confidence: action.confidence,
        approval: action.approval,
        fixSessionId: action.fixSessionId,
        fixStatus: action.fixStatus,
        fixMode: action.fixMode,
        issueUrl: action.issueUrl,
        lastSeenRunId: action.lastSeenRunId,
        createdAt: action.createdAt.getTime(),
        updatedAt: action.updatedAt.getTime(),
    };
}
