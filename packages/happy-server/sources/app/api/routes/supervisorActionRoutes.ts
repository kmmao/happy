import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
    buildSupervisorStatusEphemeral,
} from "@/app/events/eventRouter";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { onFixCompleted as loopOnFixCompleted } from "@/modules/supervisorLoopEngine";
import { log } from "@/utils/log";

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

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const where: Record<string, unknown> = {
                projectId: id,
                accountId: userId,
            };
            if (runId) where.runId = runId;
            if (category) where.category = category;

            // view takes precedence over approval
            if (view === "approved") {
                where.approval = "approved";
                where.fixStatus = null;
            } else if (view === "fixing") {
                where.approval = "approved";
                where.fixStatus = { in: ["pending", "running"] };
                where.fixMode = { not: "analyze-first" };
            } else if (view === "analyzing") {
                where.approval = "approved";
                where.fixStatus = { in: ["pending", "running"] };
                where.fixMode = "analyze-first";
            } else if (view === "analyzed") {
                where.approval = "approved";
                where.fixStatus = "analyzed";
            } else if (view === "done") {
                where.approval = "approved";
                where.fixStatus = "completed";
            } else if (view === "failed") {
                where.approval = "approved";
                where.fixStatus = "failed";
            } else if (view === "dismissed") {
                where.approval = { in: ["skipped", "ignored"] };
            } else if (approval) {
                where.approval = approval;
            }

            // Sort by updatedAt for done/fixing/analyzing views (shows latest status change first)
            const orderBy = (view === "done" || view === "fixing" || view === "analyzing" || view === "analyzed")
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

            // State transitions:
            // - Restore: dismissed/approved → pending (approved only when not actively fixing)
            // - Forward: pending → approved/skipped/ignored
            // - Post-analysis: approved (with fixStatus=analyzed) → ignored/skipped
            let fromApproval: string | { in: string[] };
            if (approval === "pending") {
                // Restore from dismissed or approved
                fromApproval = { in: ["skipped", "ignored", "approved"] };
            } else if (approval === "skipped" || approval === "ignored") {
                // Allow from pending OR from approved (post-analysis dismiss)
                fromApproval = { in: ["pending", "approved"] };
            } else {
                // approved: only from pending
                fromApproval = "pending";
            }

            const result = await db.supervisorAction.updateMany({
                where: {
                    id: actionId,
                    projectId: id,
                    accountId: userId,
                    approval: fromApproval,
                    // Block restore to pending if fix is actively running
                    // Prisma: notIn does not match NULL, so explicitly allow null
                    ...(approval === "pending"
                        ? { OR: [{ fixStatus: null }, { fixStatus: { notIn: ["pending", "running"] } }] }
                        : {}),
                },
                data: {
                    approval,
                    // Reset fix status when restoring to pending or dismissing after analysis
                    ...(approval === "pending" || approval === "skipped" || approval === "ignored"
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

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

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

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

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
                    approval: { in: ["skipped", "ignored"] },
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

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

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
                        fixStatus: { in: ["pending", "running"] },
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
            if (
                action.fixStatus === "running" ||
                action.fixStatus === "pending"
            ) {
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
            let analyzeAutoFix = false;
            if (fixMode === "analyze-first" && project.supervisorConfig) {
                try {
                    const parsed = JSON.parse(project.supervisorConfig);
                    analyzeAutoFix = parsed.analyzeAutoFix === true;
                } catch { /* ignore parse errors */ }
            }

            // Update fix status to pending and store fixMode
            await db.supervisorAction.update({
                where: { id: actionId },
                data: { fixStatus: "pending", fixMode },
            });

            const machineId =
                request.body?.machineId || project.machineId;
            const repoPath = request.body?.repoPath || project.path;

            // Emit a fix trigger event to CLI
            // Reuse supervisor-trigger with a "fix" trigger type
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorTriggerEphemeral({
                    projectId: id,
                    runId: actionId, // Use actionId as the "runId" for fix sessions
                    trigger: "fix",
                    machineId,
                    repoPath,
                    fixAction: {
                        title: action.title,
                        description: action.description,
                        suggestedFix: action.suggestedFix,
                        category: action.category,
                        severity: action.severity,
                    },
                    fixStrategy: project.fixStrategy ?? undefined,
                    fixMode,
                    analyzeAutoFix,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
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
            preHandler: app.authenticate,
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
            const userId = request.userId;
            const { id, actionId } = request.params;
            const { fixStatus, fixSessionId, issueUrl } = request.body;

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

            // Notify App clients about fix status change (mirrors socket handler)
            if (updated) {
                eventRouter.emitEphemeral({
                    userId,
                    payload: buildSupervisorStatusEphemeral(
                        updated.runId,
                        id,
                        `fix-${fixStatus}`,
                    ),
                    recipientFilter: { type: "user-scoped-only" },
                });
            }

            // On completion/failure/analyzed: tell CLI daemon to kill the fix session
            if (
                (fixStatus === "completed" || fixStatus === "failed" || fixStatus === "analyzed") &&
                updated?.fixSessionId
            ) {
                const project = await db.project.findUnique({
                    where: { id },
                    select: { machineId: true },
                });

                if (project?.machineId) {
                    eventRouter.emitEphemeral({
                        userId,
                        payload: {
                            type: "supervisor-fix-kill-session",
                            fixSessionId: updated.fixSessionId,
                            projectId: id,
                            fixStatus,
                        },
                        recipientFilter: {
                            type: "machine-scoped-only",
                            machineId: project.machineId,
                        },
                    });
                }

                // Send push notification
                const notifTitle =
                    fixStatus === "completed"
                        ? "Fix Applied Successfully"
                        : fixStatus === "analyzed"
                            ? "Analysis Complete"
                            : "Fix Failed";
                const notifBody =
                    fixStatus === "completed"
                        ? `Fixed: ${updated.title}`
                        : fixStatus === "analyzed"
                            ? `Analyzed: ${updated.title}`
                            : `Failed to fix: ${updated.title}`;
                await pushSupervisorNotification(userId, {
                    projectId: id,
                    runId: updated.runId,
                    type: fixStatus === "completed" || fixStatus === "analyzed" ? "fix_complete" : "error",
                    title: notifTitle,
                    body: notifBody,
                });
            }

            // Loop progression: if this fix belongs to a loop, check if all fixes are done
            if (fixStatus === "completed" || fixStatus === "failed" || fixStatus === "analyzed") {
                try {
                    await loopOnFixCompleted(userId, actionId, id, fixStatus);
                } catch (loopError) {
                    log(
                        { module: "supervisor", level: "error" },
                        `Loop fix progression error for action ${actionId}: ${loopError}`,
                    );
                }
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
                    fixStatus: { in: ["running", "pending"] },
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
                const now = Date.now();
                await db.session.updateMany({
                    where: { id: action.fixSessionId, active: true },
                    data: { lastActiveAt: new Date(now), active: false },
                });

                // Tell CLI daemon to kill the session
                const project = await db.project.findUnique({
                    where: { id },
                    select: { machineId: true },
                });

                if (project?.machineId) {
                    eventRouter.emitEphemeral({
                        userId,
                        payload: {
                            type: "supervisor-fix-kill-session",
                            fixSessionId: action.fixSessionId,
                            projectId: id,
                            fixStatus: resolution,
                        },
                        recipientFilter: {
                            type: "machine-scoped-only",
                            machineId: project.machineId,
                        },
                    });
                }
            }

            // Notify App clients
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorStatusEphemeral(
                    action.runId,
                    id,
                    `fix-${resolution}`,
                ),
                recipientFilter: { type: "user-scoped-only" },
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

            // Loop progression
            try {
                await loopOnFixCompleted(userId, actionId, id, resolution);
            } catch (loopError) {
                log(
                    { module: "supervisor", level: "error" },
                    `Force-resolve loop progression error for action ${actionId}: ${loopError}`,
                );
            }

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
