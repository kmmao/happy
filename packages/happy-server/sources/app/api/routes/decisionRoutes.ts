import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { decisionCreate } from "@/modules/decisionCreate";
import { decisionAdjudicate } from "@/modules/decisionAdjudicate";
import { matchPrecedent } from "@/modules/decisionMatch";
import { reassignDecision } from "@/modules/decisionRoute";
import { requireRole, resolveEffectiveMember } from "@/modules/worldMemberResolve";
import { addDecisionOpinion } from "@/modules/decisionOpinion";
import { log } from "@/utils/log";

const OptionSchema = z.object({
    id: z.string(),
    description: z.string().max(500),
    pros: z.string().max(500).optional(),
    cons: z.string().max(500).optional(),
});

const CreateDecisionBodySchema = z.object({
    question: z.string().min(1).max(2000),
    options: z.array(OptionSchema).min(2).max(10),
    context: z.string().max(5000).optional(),
    precedentKey: z.string().max(200).optional(),
    agentRole: z.string().max(200).optional(),
    sessionId: z.string().optional(),
    loopId: z.string().optional(),
});

const AdjudicateBodySchema = z.object({
    chosenOption: z.string(),
    rationale: z.string().max(2000).optional(),
});

const QueryDecisionsSchema = z.object({
    status: z.enum(["pending", "decided", "expired", "auto_resolved"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Decision CRUD + adjudication routes.
 */
export function decisionRoutes(app: Fastify) {
    // POST /v1/projects/:id/decisions — create a new decision (from CLI Agent)
    app.post(
        "/v1/projects/:id/decisions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: CreateDecisionBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            // Verify project ownership
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const { question, options, context, precedentKey, agentRole, sessionId, loopId } = request.body;

            // Check for existing precedent before creating
            if (precedentKey) {
                const existing = await matchPrecedent(projectId, precedentKey, question);
                if (existing) {
                    return reply.send({
                        matched: true,
                        precedent: existing,
                    });
                }
            }

            const result = await decisionCreate({
                accountId: userId,
                projectId,
                question,
                options: JSON.stringify(options),
                context,
                precedentKey,
                agentRole,
                sessionId,
                loopId,
            });

            return reply.code(201).send({
                matched: false,
                decision: { id: result.id, status: "pending" },
            });
        },
    );

    // GET /v1/projects/:id/decisions — list decisions
    app.get(
        "/v1/projects/:id/decisions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: QueryDecisionsSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { status, limit, offset } = request.query;

            const where: Record<string, unknown> = {
                accountId: userId,
                projectId,
            };
            if (status) {
                where.status = status;
            }

            const [decisions, total] = await Promise.all([
                db.decision.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.decision.count({ where }),
            ]);

            return reply.send({
                decisions: decisions.map(serializeDecision),
                total,
            });
        },
    );

    // GET /v1/projects/:id/decisions/:decisionId — get single decision
    app.get(
        "/v1/projects/:id/decisions/:decisionId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), decisionId: z.string() }),
            },
        },
        async (request, reply) => {
            const decision = await db.decision.findFirst({
                where: {
                    id: request.params.decisionId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!decision) {
                return reply.code(404).send({ error: "Decision not found" });
            }
            return reply.send({ decision: serializeDecision(decision) });
        },
    );

    // POST /v1/projects/:id/decisions/:decisionId/adjudicate — adjudicate (from App)
    app.post(
        "/v1/projects/:id/decisions/:decisionId/adjudicate",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), decisionId: z.string() }),
                body: AdjudicateBodySchema,
            },
        },
        async (request, reply) => {
            try {
                const result = await decisionAdjudicate({
                    decisionId: request.params.decisionId,
                    accountId: request.userId,
                    chosenOption: request.body.chosenOption,
                    rationale: request.body.rationale,
                });
                return reply.send(result);
            } catch (e: any) {
                const message = e?.message ?? "Decision not found or already resolved";
                if (message === "Invalid decision option") {
                    return reply.code(400).send({ error: message });
                }
                if (message === "Decision options are invalid") {
                    return reply.code(500).send({ error: message });
                }
                if (message === "Decision not found or already resolved") {
                    return reply.code(404).send({ error: message });
                }
                log({ module: "decision", level: "error" }, `Failed to adjudicate decision ${request.params.decisionId}: ${message}`);
                return reply.code(500).send({ error: "Internal server error" });
            }
        },
    );

    // GET /v1/decisions/:decisionId — get single decision without project context (from App Inbox)
    app.get(
        "/v1/decisions/:decisionId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ decisionId: z.string() }),
            },
        },
        async (request, reply) => {
            const decision = await db.decision.findFirst({
                where: {
                    id: request.params.decisionId,
                    accountId: request.userId,
                },
            });
            if (!decision) {
                return reply.code(404).send({ error: "Decision not found" });
            }
            return reply.send({ decision: serializeDecision(decision) });
        },
    );

    // POST /v1/projects/:id/decisions/:decisionId/opinion — submit member opinion
    app.post(
        "/v1/projects/:id/decisions/:decisionId/opinion",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), decisionId: z.string() }),
                body: z.object({
                    chosenOption: z.string(),
                    rationale: z.string().max(2000).optional(),
                }),
            },
        },
        async (request, reply) => {
            const member = await resolveEffectiveMember(request.userId, request.params.id);
            if (member.decisionScope === "none") {
                return reply.code(403).send({ error: "No decision authority" });
            }

            try {
                const result = await addDecisionOpinion({
                    decisionId: request.params.decisionId,
                    accountId: request.userId,
                    memberId: member.id ?? request.userId,
                    chosenOption: request.body.chosenOption,
                    rationale: request.body.rationale,
                });
                return reply.send(result);
            } catch (e: any) {
                if (e.statusCode) {
                    return reply.code(e.statusCode).send({ error: e.message });
                }
                throw e;
            }
        },
    );

    // POST /v1/projects/:id/decisions/:decisionId/reassign — manually reassign to another member
    app.post(
        "/v1/projects/:id/decisions/:decisionId/reassign",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), decisionId: z.string() }),
                body: z.object({ memberId: z.string() }),
            },
        },
        async (request, reply) => {
            await requireRole(request.userId, request.params.id, "admin");

            const decision = await db.decision.findFirst({
                where: {
                    id: request.params.decisionId,
                    projectId: request.params.id,
                    status: "pending",
                },
            });
            if (!decision) {
                return reply.code(404).send({ error: "Pending decision not found" });
            }

            await reassignDecision(decision.id, request.body.memberId, "manual_reassign");
            const updated = await db.decision.findUnique({ where: { id: decision.id } });
            return reply.send({ decision: updated ? serializeDecision(updated) : null });
        },
    );

    // GET /v1/projects/:id/decisions/match — match precedent (from CLI Agent)
    app.get(
        "/v1/projects/:id/decisions/match",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    precedentKey: z.string().optional(),
                    question: z.string().optional(),
                }),
            },
        },
        async (request, reply) => {
            const { precedentKey, question } = request.query;

            const match = await matchPrecedent(
                request.params.id,
                precedentKey,
                question ?? "",
            );

            return reply.send({ matched: match !== null, precedent: match });
        },
    );
}

// === Serialization ===

function serializeDecision(d: {
    id: string;
    projectId: string;
    agentRole: string | null;
    sessionId: string | null;
    loopId: string | null;
    question: string;
    context: string | null;
    options: string;
    status: string;
    chosenOption: string | null;
    rationale: string | null;
    knowledgeId: string | null;
    precedentKey: string | null;
    assignedTo: string | null;
    assignHistory: string;
    opinions: string;
    expiresAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: d.id,
        projectId: d.projectId,
        agentRole: d.agentRole,
        sessionId: d.sessionId,
        loopId: d.loopId,
        question: d.question,
        context: d.context,
        options: safeParseJsonArray(d.options),
        status: d.status,
        chosenOption: d.chosenOption,
        rationale: d.rationale,
        knowledgeId: d.knowledgeId,
        precedentKey: d.precedentKey,
        assignedTo: d.assignedTo,
        assignHistory: safeParseJsonArray(d.assignHistory),
        opinions: safeParseJsonArray(d.opinions),
        expiresAt: d.expiresAt?.getTime() ?? null,
        decidedAt: d.decidedAt?.getTime() ?? null,
        createdAt: d.createdAt.getTime(),
        updatedAt: d.updatedAt.getTime(),
    };
}

function safeParseJsonArray(json: string): unknown[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
