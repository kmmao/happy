import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { worldMemberCreate } from "@/modules/worldMemberCreate";
import { worldMemberUpdate } from "@/modules/worldMemberUpdate";
import { worldMemberRemove } from "@/modules/worldMemberRemove";
import { requireRole } from "@/modules/worldMemberResolve";
import { queryAuditLogs } from "@/modules/worldAuditLog";

const MEMBER_ROLES = ["owner", "admin", "member", "observer"] as const;

const CreateMemberBodySchema = z.object({
    accountId: z.string(),
    role: z.enum(MEMBER_ROLES).default("member"),
    displayName: z.string().max(100).optional(),
    expertise: z.array(z.string().max(50)).max(20).default([]),
});

const UpdateMemberBodySchema = z.object({
    role: z.enum(MEMBER_ROLES).optional(),
    displayName: z.string().max(100).nullable().optional(),
    expertise: z.array(z.string().max(50)).max(20).optional(),
    maxConcurrency: z.number().int().min(1).max(20).optional(),
    assignedRoleIds: z.array(z.string()).max(10).optional(),
    lawAuthority: z.enum(["create", "suggest", "readonly"]).optional(),
    decisionScope: z.enum(["all", "assigned", "none"]).optional(),
    goalAuthority: z.enum(["create", "suggest", "readonly"]).optional(),
    notifyLevel: z.enum(["all", "critical", "assigned", "none"]).optional(),
    availability: z.enum(["active", "away", "delegate"]).optional(),
    delegateTo: z.string().nullable().optional(),
});

/**
 * WorldMember CRUD routes.
 * Manages team collaboration within a project's World Model.
 */
export function worldMemberRoutes(app: Fastify) {
    // GET /v1/projects/:projectId/members — list members
    app.get(
        "/v1/projects/:projectId/members",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
                querystring: z.object({
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                    offset: z.coerce.number().int().min(0).default(0),
                }),
            },
        },
        async (request, reply) => {
            const { projectId } = request.params;

            // Any project participant can list members (observer+)
            await requireRole(request.userId, projectId, "observer");

            const where = { projectId };
            const [members, total] = await Promise.all([
                db.worldMember.findMany({
                    where,
                    include: {
                        account: { select: { id: true, username: true, firstName: true, lastName: true, avatar: true } },
                    },
                    orderBy: { joinedAt: "asc" },
                    take: request.query.limit,
                    skip: request.query.offset,
                }),
                db.worldMember.count({ where }),
            ]);

            return reply.send({
                members: members.map(serializeMember),
                total,
            });
        },
    );

    // POST /v1/projects/:projectId/members — add a member (admin+)
    app.post(
        "/v1/projects/:projectId/members",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
                body: CreateMemberBodySchema,
            },
        },
        async (request, reply) => {
            const { projectId } = request.params;
            await requireRole(request.userId, projectId, "admin");

            try {
                const member = await worldMemberCreate({
                    accountId: request.body.accountId,
                    projectId,
                    invitedBy: request.userId,
                    role: request.body.role,
                    displayName: request.body.displayName,
                    expertise: request.body.expertise,
                });

                // Re-fetch with account info for serialization
                const full = await db.worldMember.findUnique({
                    where: { id: member.id },
                    include: {
                        account: { select: { id: true, username: true, firstName: true, lastName: true, avatar: true } },
                    },
                });

                return reply.code(201).send({ member: full ? serializeMember(full) : member });
            } catch (e: any) {
                if (e.code === "P2002") {
                    return reply.code(409).send({ error: "member-already-exists" });
                }
                if (e.statusCode) {
                    return reply.code(e.statusCode).send({ error: e.message });
                }
                throw e;
            }
        },
    );

    // PATCH /v1/projects/:projectId/members/:memberId — update member
    app.patch(
        "/v1/projects/:projectId/members/:memberId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string(), memberId: z.string() }),
                body: UpdateMemberBodySchema,
            },
        },
        async (request, reply) => {
            const { projectId, memberId } = request.params;
            await requireRole(request.userId, projectId, "admin");

            const existing = await db.worldMember.findFirst({
                where: { id: memberId, projectId },
            });
            if (!existing) {
                return reply.code(404).send({ error: "Member not found" });
            }

            // Cannot change owner's role
            if (existing.role === "owner" && request.body.role && request.body.role !== "owner") {
                return reply.code(403).send({ error: "Cannot change the owner's role" });
            }

            const updated = await worldMemberUpdate({
                memberId,
                ...request.body,
            });

            const full = await db.worldMember.findUnique({
                where: { id: updated.id },
                include: {
                    account: { select: { id: true, username: true, firstName: true, lastName: true, avatar: true } },
                },
            });

            return reply.send({ member: full ? serializeMember(full) : updated });
        },
    );

    // DELETE /v1/projects/:projectId/members/:memberId — remove member
    app.delete(
        "/v1/projects/:projectId/members/:memberId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string(), memberId: z.string() }),
            },
        },
        async (request, reply) => {
            const { projectId, memberId } = request.params;
            await requireRole(request.userId, projectId, "admin");

            const existing = await db.worldMember.findFirst({
                where: { id: memberId, projectId },
            });
            if (!existing) {
                return reply.code(404).send({ error: "Member not found" });
            }

            try {
                await worldMemberRemove(memberId);
                return reply.send({ deleted: true });
            } catch (e: any) {
                if (e.statusCode) {
                    return reply.code(e.statusCode).send({ error: e.message });
                }
                throw e;
            }
        },
    );

    // GET /v1/projects/:projectId/members/me — get current user's effective membership
    app.get(
        "/v1/projects/:projectId/members/me",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
            },
        },
        async (request, reply) => {
            const { resolveEffectiveMember } = await import("@/modules/worldMemberResolve");
            const member = await resolveEffectiveMember(request.userId, request.params.projectId);
            return reply.send({ member });
        },
    );

    // GET /v1/projects/:projectId/audit-log — list audit log entries
    app.get(
        "/v1/projects/:projectId/audit-log",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
                querystring: z.object({
                    entityType: z.string().optional(),
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                    offset: z.coerce.number().int().min(0).default(0),
                }),
            },
        },
        async (request, reply) => {
            await requireRole(request.userId, request.params.projectId, "observer");
            const result = await queryAuditLogs({
                projectId: request.params.projectId,
                entityType: request.query.entityType,
                limit: request.query.limit,
                offset: request.query.offset,
            });
            return reply.send(result);
        },
    );

    // GET /v1/projects/:projectId/member-stats — member activity summary
    app.get(
        "/v1/projects/:projectId/member-stats",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
            },
        },
        async (request, reply) => {
            await requireRole(request.userId, request.params.projectId, "observer");
            const projectId = request.params.projectId;

            const [members, decisionStats, auditCounts] = await Promise.all([
                db.worldMember.findMany({
                    where: { projectId },
                    include: {
                        account: { select: { id: true, username: true, firstName: true, lastName: true } },
                    },
                }),
                // Decisions decided per member (by assignedTo)
                db.decision.groupBy({
                    by: ["assignedTo"],
                    where: { projectId, status: "decided", assignedTo: { not: null } },
                    _count: true,
                }),
                // Audit actions per account
                db.worldAuditLog.groupBy({
                    by: ["accountId"],
                    where: { projectId },
                    _count: true,
                }),
            ]);

            const decisionMap = new Map(decisionStats.map((d) => [d.assignedTo, d._count]));
            const auditMap = new Map(auditCounts.map((a) => [a.accountId, a._count]));

            const stats = members.map((m) => ({
                memberId: m.id,
                accountId: m.accountId,
                displayName: m.displayName,
                role: m.role,
                availability: m.availability,
                account: m.account ? {
                    username: m.account.username,
                    firstName: m.account.firstName,
                    lastName: m.account.lastName,
                } : null,
                decisionsResolved: decisionMap.get(m.id) ?? 0,
                auditActions: auditMap.get(m.accountId) ?? 0,
            }));

            return reply.send({ stats });
        },
    );
}

// === Serialization ===

function serializeMember(member: {
    id: string;
    accountId: string;
    projectId: string;
    displayName: string | null;
    role: string;
    expertise: string;
    lawAuthority: string;
    decisionScope: string;
    goalAuthority: string;
    notifyLevel: string;
    availability: string;
    delegateTo: string | null;
    maxConcurrency: number;
    assignedRoleIds: string;
    agentType: string | null;
    modelOverride: string | null;
    joinedAt: Date;
    updatedAt: Date;
    account?: { id: string; username: string | null; firstName: string | null; lastName: string | null; avatar: unknown } | null;
}) {
    let expertise: string[] = [];
    try { expertise = JSON.parse(member.expertise); } catch { /* keep empty */ }
    let assignedRoleIds: string[] = [];
    try { assignedRoleIds = JSON.parse(member.assignedRoleIds); } catch { /* keep empty */ }

    return {
        id: member.id,
        accountId: member.accountId,
        projectId: member.projectId,
        displayName: member.displayName,
        role: member.role,
        expertise,
        lawAuthority: member.lawAuthority,
        decisionScope: member.decisionScope,
        goalAuthority: member.goalAuthority,
        notifyLevel: member.notifyLevel,
        availability: member.availability,
        delegateTo: member.delegateTo,
        maxConcurrency: member.maxConcurrency,
        assignedRoleIds,
        agentType: member.agentType,
        modelOverride: member.modelOverride,
        joinedAt: member.joinedAt.getTime(),
        updatedAt: member.updatedAt.getTime(),
        account: member.account ? {
            id: member.account.id,
            username: member.account.username,
            firstName: member.account.firstName,
            lastName: member.account.lastName,
            avatar: member.account.avatar,
        } : null,
    };
}
