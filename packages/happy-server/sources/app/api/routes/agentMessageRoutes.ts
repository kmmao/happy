import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { decisionCreate } from "@/modules/decisionCreate";
import { inboxCreate } from "@/modules/inboxCreate";
import { truncateText, TEXT_LIMITS } from "@/modules/worldConstants";
import {
    eventRouter,
    buildAgentMessageEphemeral,
} from "@/app/events/eventRouter";
import { dispatchQueuedTasksForMember, dispatchQueuedTasksForImplicitOwner } from "@/modules/memberConcurrencyCheck";
import { agentEscalateToMember } from "@/modules/agentEscalateToMember";

const MsgTypeSchema = z.enum([
    "request",
    "report",
    "conflict",
    "law_suggestion",
    "dependency_blocked",
    "handoff",
    "review_request",
    "decision_request",
]);

const CreateMessageBodySchema = z.object({
    fromRole: z.string().min(1).max(200),
    toRole: z.string().max(200).optional(),
    msgType: MsgTypeSchema,
    content: z.string().min(1).max(10000),
    sessionId: z.string().optional(),
    relatedGoalId: z.string().optional(),
    relatedTaskId: z.string().optional(),
    priority: z.enum(["urgent", "normal", "low"]).optional(),
});

const UserWritableMessageStatusSchema = z.enum(["unread", "read"]);

const QueryMessagesSchema = z.object({
    msgType: MsgTypeSchema.optional(),
    status: z.enum(["unread", "read", "resolved"]).optional(),
    relatedGoalId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});


/**
 * AgentMessage CRUD — inter-agent communication records.
 * Supports 8 msgTypes: request, report, conflict, law_suggestion,
 * dependency_blocked, handoff, review_request, decision_request.
 * conflict + law_suggestion + decision_request auto-escalate to Decision.
 * dependency_blocked + review_request create InboxItems.
 */
export function agentMessageRoutes(app: Fastify) {
    // POST /v1/projects/:id/agent-messages — create a message
    app.post(
        "/v1/projects/:id/agent-messages",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: CreateMessageBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const {
                fromRole,
                toRole,
                msgType,
                content,
                sessionId,
                relatedGoalId,
                relatedTaskId,
                priority,
            } = request.body;

            const message = await db.agentMessage.create({
                data: {
                    accountId: userId,
                    projectId,
                    fromRole,
                    toRole: toRole ?? null,
                    msgType,
                    content,
                    sessionId: sessionId ?? null,
                    relatedGoalId: relatedGoalId ?? null,
                    relatedTaskId: relatedTaskId ?? null,
                    priority: priority ?? "normal",
                },
            });

            // Emit ephemeral to App
            eventRouter.emitEphemeral({
                userId,
                payload: buildAgentMessageEphemeral({
                    messageId: message.id,
                    projectId,
                    fromRole,
                    toRole: toRole ?? null,
                    msgType,
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Auto-create Decision for conflict messages
            if (msgType === "conflict") {
                const decisionResult = await decisionCreate({
                    accountId: userId,
                    projectId,
                    question: `Agent conflict: ${fromRole}${toRole ? ` → ${toRole}` : ""}: ${truncateText(content, TEXT_LIMITS.AGENT_MSG_BODY)}`,
                    options: JSON.stringify([
                        { id: "resolve_a", description: `Side with ${fromRole}` },
                        { id: "resolve_b", description: toRole ? `Side with ${toRole}` : "Alternative approach" },
                        { id: "dismiss", description: "Dismiss conflict" },
                    ]),
                    context: content,
                    precedentKey: `conflict:${fromRole}:${toRole ?? "broadcast"}`,
                    agentRole: fromRole,
                    sessionId,
                });

                await db.agentMessage.update({
                    where: { id: message.id },
                    data: { decisionId: decisionResult.id },
                });

                log({ module: "agent-message" }, `Conflict escalated to decision ${decisionResult.id}`);
            }

            // Auto-create Decision for law_suggestion messages
            if (msgType === "law_suggestion") {
                const decisionResult = await decisionCreate({
                    accountId: userId,
                    projectId,
                    question: `Law suggestion from ${fromRole}: ${truncateText(content, TEXT_LIMITS.REASON_SHORT)}`,
                    options: JSON.stringify([
                        { id: "approve", description: "Approve and add to project laws" },
                        { id: "reject", description: "Reject this suggestion" },
                    ]),
                    context: content,
                    precedentKey: `law_suggestion:${fromRole}`,
                    agentRole: fromRole,
                    sessionId,
                });

                await db.agentMessage.update({
                    where: { id: message.id },
                    data: { decisionId: decisionResult.id },
                });

                log({ module: "agent-message" }, `Law suggestion escalated to decision ${decisionResult.id}`);
            }

            // Auto-create Decision for decision_request messages
            if (msgType === "decision_request") {
                const decisionResult = await decisionCreate({
                    accountId: userId,
                    projectId,
                    question: `Decision requested by ${fromRole}${toRole ? ` → ${toRole}` : ""}: ${truncateText(content, TEXT_LIMITS.AGENT_MSG_BODY)}`,
                    options: JSON.stringify([
                        { id: "approve", description: "Approve this approach" },
                        { id: "reject", description: "Reject and reconsider" },
                        { id: "defer", description: "Defer decision" },
                    ]),
                    context: content,
                    precedentKey: `decision_request:${fromRole}:${toRole ?? "broadcast"}`,
                    agentRole: fromRole,
                    sessionId,
                });

                await db.agentMessage.update({
                    where: { id: message.id },
                    data: { decisionId: decisionResult.id },
                });

                log({ module: "agent-message" }, `Decision request escalated to decision ${decisionResult.id}`);

                // Pause the task that issued this decision request
                if (sessionId) {
                    const runningTask = await db.task.findFirst({
                        where: {
                            accountId: userId,
                            projectId,
                            sessionId,
                            status: { in: ["running", "dispatching"] },
                        },
                        select: { id: true, roleType: true, machineId: true, assignedMemberId: true },
                    });
                    if (runningTask) {
                        await db.task.update({
                            where: { id: runningTask.id },
                            data: { status: "waiting_decision", waitingDecisionId: decisionResult.id },
                        });
                        log({ module: "agent-message" }, `Task ${runningTask.id} paused waiting for decision ${decisionResult.id}`);

                        // Free concurrency slot so queued tasks can proceed
                        if (runningTask.assignedMemberId) {
                            void dispatchQueuedTasksForMember({
                                memberId: runningTask.assignedMemberId,
                                accountId: userId,
                                machineId: runningTask.machineId,
                            });
                        } else if (runningTask.roleType) {
                            void dispatchQueuedTasksForImplicitOwner({
                                accountId: userId,
                                projectId,
                                machineId: runningTask.machineId,
                                roleType: runningTask.roleType,
                            });
                        }
                    }
                }
            }

            // Create InboxItem for conflict, law_suggestion, dependency_blocked, review_request
            if (msgType === "conflict" || msgType === "law_suggestion") {
                void inboxCreate({
                    accountId: userId,
                    category: "agent",
                    eventType: `agent.${msgType}`,
                    severity: msgType === "conflict" ? "warning" : "info",
                    title: msgType === "conflict"
                        ? `Agent conflict: ${fromRole}${toRole ? ` → ${toRole}` : ""}`
                        : `Law suggestion from ${fromRole}`,
                    body: truncateText(content, TEXT_LIMITS.AGENT_MSG_BODY),
                    referenceUrl: `/project/${projectId}?tab=world`,
                    refType: "agent-message",
                    refId: message.id,
                    groupKey: `agent:${msgType}:${projectId}:${fromRole}`,
                });
            }

            if (msgType === "dependency_blocked") {
                void inboxCreate({
                    accountId: userId,
                    category: "agent",
                    eventType: "agent.dependency_blocked",
                    severity: "warning",
                    title: `${fromRole} blocked${toRole ? ` waiting for ${toRole}` : ""}`,
                    body: truncateText(content, TEXT_LIMITS.AGENT_MSG_BODY),
                    referenceUrl: `/project/${projectId}?tab=world`,
                    refType: "agent-message",
                    refId: message.id,
                    groupKey: `agent:dependency_blocked:${projectId}:${fromRole}:${toRole ?? ""}`,
                });
            }

            if (msgType === "review_request") {
                void inboxCreate({
                    accountId: userId,
                    category: "agent",
                    eventType: "agent.review_request",
                    severity: "info",
                    title: `${fromRole} requests review${toRole ? ` from ${toRole}` : ""}`,
                    body: truncateText(content, TEXT_LIMITS.AGENT_MSG_BODY),
                    referenceUrl: `/project/${projectId}?tab=world`,
                    refType: "agent-message",
                    refId: message.id,
                    groupKey: `agent:review_request:${projectId}:${fromRole}:${toRole ?? ""}`,
                });
            }

            log({ module: "agent-message" }, `Created ${msgType} message from ${fromRole} in project ${projectId}`);

            return reply.code(201).send({ message: serializeMessage(message) });
        },
    );

    // GET /v1/projects/:id/agent-messages — list messages
    app.get(
        "/v1/projects/:id/agent-messages",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: QueryMessagesSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { msgType, status, relatedGoalId, limit, offset } = request.query;

            const where: Record<string, unknown> = {
                accountId: userId,
                projectId,
            };
            if (msgType) where.msgType = msgType;
            if (status) where.status = status;
            if (relatedGoalId) where.relatedGoalId = relatedGoalId;

            const [messages, total] = await Promise.all([
                db.agentMessage.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.agentMessage.count({ where }),
            ]);

            return reply.send({
                messages: messages.map(serializeMessage),
                total,
            });
        },
    );

    // PATCH /v1/projects/:id/agent-messages/:msgId — update status
    app.patch(
        "/v1/projects/:id/agent-messages/:msgId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), msgId: z.string() }),
                body: z.object({
                    status: UserWritableMessageStatusSchema,
                }),
            },
        },
        async (request, reply) => {
            const message = await db.agentMessage.findFirst({
                where: {
                    id: request.params.msgId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!message) {
                return reply.code(404).send({ error: "Message not found" });
            }

            const updated = await db.agentMessage.update({
                where: { id: message.id },
                data: { status: request.body.status },
            });

            return reply.send({ message: serializeMessage(updated) });
        },
    );

    // POST /v1/projects/:id/agent-messages/escalate — agent escalates issue to human member
    app.post(
        "/v1/projects/:id/agent-messages/escalate",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    fromRole: z.string().min(1).max(200),
                    content: z.string().min(1).max(10000),
                    escalationType: z.enum(["technical", "process", "permission"]),
                    contextTags: z.array(z.string().max(50)).max(20).default([]),
                    sessionId: z.string().optional(),
                    relatedGoalId: z.string().optional(),
                    relatedTaskId: z.string().optional(),
                }),
            },
        },
        async (request, reply) => {
            const projectId = request.params.id;
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: request.userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const result = await agentEscalateToMember({
                accountId: request.userId,
                projectId,
                fromRole: request.body.fromRole,
                msgType: "request",
                content: request.body.content,
                escalationType: request.body.escalationType,
                contextTags: request.body.contextTags,
                sessionId: request.body.sessionId,
                relatedGoalId: request.body.relatedGoalId,
                relatedTaskId: request.body.relatedTaskId,
            });

            return reply.code(201).send({
                messageId: result.messageId,
                targetMemberId: result.targetMemberId,
            });
        },
    );
}

// === Serialization ===

function serializeMessage(m: {
    id: string;
    projectId: string;
    fromRole: string;
    toRole: string | null;
    toMemberId: string | null;
    msgType: string;
    content: string;
    status: string;
    sessionId: string | null;
    decisionId: string | null;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    priority: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: m.id,
        projectId: m.projectId,
        fromRole: m.fromRole,
        toRole: m.toRole,
        toMemberId: m.toMemberId,
        msgType: m.msgType,
        content: m.content,
        status: m.status,
        sessionId: m.sessionId,
        decisionId: m.decisionId,
        relatedGoalId: m.relatedGoalId,
        relatedTaskId: m.relatedTaskId,
        priority: m.priority ?? "normal",
        createdAt: m.createdAt.getTime(),
        updatedAt: m.updatedAt.getTime(),
    };
}
