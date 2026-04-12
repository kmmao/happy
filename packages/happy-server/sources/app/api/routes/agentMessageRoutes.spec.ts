import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type AgentMessageRecord = {
    id: string;
    projectId: string;
    accountId: string;
    fromRole: string;
    toRole: string | null;
    msgType: string;
    content: string;
    status: "unread" | "read" | "resolved";
    sessionId: string | null;
    decisionId: string | null;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    priority: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const { state, dbMock, resetState, seedMessage } = vi.hoisted(() => {
    const state = {
        messages: [] as AgentMessageRecord[],
    };

    const resetState = () => {
        state.messages = [];
    };

    const seedMessage = (input: Partial<AgentMessageRecord> & Pick<AgentMessageRecord, "id" | "projectId" | "accountId">) => {
        const now = new Date();
        state.messages.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            fromRole: input.fromRole ?? "planner",
            toRole: input.toRole ?? null,
            msgType: input.msgType ?? "conflict",
            content: input.content ?? "content",
            status: input.status ?? "unread",
            sessionId: input.sessionId ?? null,
            decisionId: input.decisionId ?? null,
            relatedGoalId: input.relatedGoalId ?? null,
            relatedTaskId: input.relatedTaskId ?? null,
            priority: input.priority ?? "normal",
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        });
    };

    const agentMessageFindFirst = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.messages.find((message) => (
            message.id === where.id
            && message.projectId === where.projectId
            && message.accountId === where.accountId
        )) ?? null;
    });

    const agentMessageUpdate = vi.fn(async (args: any) => {
        const message = state.messages.find((item) => item.id === args.where.id);
        if (!message) throw new Error("Message not found");
        Object.assign(message, args.data, { updatedAt: new Date() });
        return message;
    });

    const dbMock = {
        project: {
            findFirst: vi.fn(async () => ({ id: "project-1" })),
        },
        agentMessage: {
            findFirst: agentMessageFindFirst,
            update: agentMessageUpdate,
            create: vi.fn(),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
        },
    };

    return { state, dbMock, resetState, seedMessage };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/modules/decisionCreate", () => ({ decisionCreate: vi.fn() }));
vi.mock("@/modules/inboxCreate", () => ({ inboxCreate: vi.fn() }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: vi.fn() },
    buildAgentMessageEphemeral: vi.fn((payload: unknown) => payload),
}));

import { agentMessageRoutes } from "./agentMessageRoutes";
import { decisionCreate } from "@/modules/decisionCreate";
import { inboxCreate } from "@/modules/inboxCreate";

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate("authenticate", async (request: any, reply: any) => {
        const userId = request.headers["x-user-id"];
        if (typeof userId !== "string") {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = userId;
    });

    agentMessageRoutes(typed);
    await typed.ready();
    return typed;
}

describe("agentMessageRoutes POST /v1/projects/:id/agent-messages — new message types", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();

        const createdMsg = {
            id: "new-msg",
            projectId: "project-1",
            accountId: "user-1",
            fromRole: "builder",
            toRole: null,
            msgType: "dependency_blocked",
            content: "waiting for planner",
            status: "unread" as const,
            sessionId: null,
            decisionId: null,
            relatedGoalId: null,
            relatedTaskId: null,
            priority: "normal",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        dbMock.agentMessage.create.mockResolvedValue(createdMsg);
        (decisionCreate as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "decision-new" });
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("creates dependency_blocked message with relatedGoalId and relatedTaskId", async () => {
        dbMock.agentMessage.create.mockResolvedValueOnce({
            id: "msg-dep",
            projectId: "project-1",
            accountId: "user-1",
            fromRole: "builder",
            toRole: "planner",
            msgType: "dependency_blocked",
            content: "waiting for schema",
            status: "unread",
            sessionId: null,
            decisionId: null,
            relatedGoalId: "goal-1",
            relatedTaskId: "task-1",
            priority: "normal",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/agent-messages",
            headers: { "x-user-id": "user-1" },
            payload: {
                fromRole: "builder",
                toRole: "planner",
                msgType: "dependency_blocked",
                content: "waiting for schema",
                relatedGoalId: "goal-1",
                relatedTaskId: "task-1",
            },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json();
        expect(body.message.relatedGoalId).toBe("goal-1");
        expect(body.message.relatedTaskId).toBe("task-1");
        expect(body.message.msgType).toBe("dependency_blocked");

        // Creates InboxItem for dependency_blocked
        expect(inboxCreate).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: "agent.dependency_blocked", severity: "warning" }),
        );

        // Does NOT create a Decision
        expect(decisionCreate).not.toHaveBeenCalled();
    });

    it("auto-escalates decision_request to Decision", async () => {
        const drMsg = {
            id: "msg-dr",
            projectId: "project-1",
            accountId: "user-1",
            fromRole: "planner",
            toRole: null as null,
            msgType: "decision_request",
            content: "Should we use approach A or B?",
            status: "unread" as const,
            sessionId: null,
            decisionId: null as null,
            relatedGoalId: null as null,
            relatedTaskId: null as null,
            priority: "urgent",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        dbMock.agentMessage.create.mockResolvedValueOnce(drMsg);
        dbMock.agentMessage.update.mockResolvedValueOnce({ ...drMsg, decisionId: "decision-new" });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/agent-messages",
            headers: { "x-user-id": "user-1" },
            payload: {
                fromRole: "planner",
                msgType: "decision_request",
                content: "Should we use approach A or B?",
                priority: "urgent",
            },
        });

        expect(res.statusCode).toBe(201);
        expect(decisionCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                precedentKey: "decision_request:planner:broadcast",
            }),
        );
        expect(dbMock.agentMessage.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { decisionId: "decision-new" } }),
        );
    });

    it("creates handoff message with dual roles, no Decision or InboxItem", async () => {
        dbMock.agentMessage.create.mockResolvedValueOnce({
            id: "msg-ho",
            projectId: "project-1",
            accountId: "user-1",
            fromRole: "planner",
            toRole: "builder",
            msgType: "handoff",
            content: "Passing schema design to builder",
            status: "unread",
            sessionId: null,
            decisionId: null,
            relatedGoalId: null,
            relatedTaskId: null,
            priority: "normal",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/agent-messages",
            headers: { "x-user-id": "user-1" },
            payload: {
                fromRole: "planner",
                toRole: "builder",
                msgType: "handoff",
                content: "Passing schema design to builder",
            },
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().message.toRole).toBe("builder");
        expect(decisionCreate).not.toHaveBeenCalled();
        expect(inboxCreate).not.toHaveBeenCalled();
    });

    it("creates review_request InboxItem with info severity", async () => {
        dbMock.agentMessage.create.mockResolvedValueOnce({
            id: "msg-rr",
            projectId: "project-1",
            accountId: "user-1",
            fromRole: "builder",
            toRole: "reviewer",
            msgType: "review_request",
            content: "Please review PR #42",
            status: "unread",
            sessionId: null,
            decisionId: null,
            relatedGoalId: null,
            relatedTaskId: null,
            priority: "normal",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/agent-messages",
            headers: { "x-user-id": "user-1" },
            payload: {
                fromRole: "builder",
                toRole: "reviewer",
                msgType: "review_request",
                content: "Please review PR #42",
            },
        });

        expect(res.statusCode).toBe(201);
        expect(inboxCreate).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: "agent.review_request", severity: "info" }),
        );
        expect(decisionCreate).not.toHaveBeenCalled();
    });
});

describe("agentMessageRoutes GET /v1/projects/:id/agent-messages — relatedGoalId filter", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
        dbMock.agentMessage.findMany.mockResolvedValue([]);
        dbMock.agentMessage.count.mockResolvedValue(0);
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("passes relatedGoalId filter to db query", async () => {
        app = await createApp();

        await app.inject({
            method: "GET",
            url: "/v1/projects/project-1/agent-messages?relatedGoalId=goal-abc",
            headers: { "x-user-id": "user-1" },
        });

        expect(dbMock.agentMessage.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ relatedGoalId: "goal-abc" }),
            }),
        );
    });
});

describe("agentMessageRoutes PATCH /v1/projects/:id/agent-messages/:msgId", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("rejects direct resolved status updates from client", async () => {
        seedMessage({
            id: "msg-1",
            projectId: "project-1",
            accountId: "user-1",
            status: "unread",
        });
        app = await createApp();

        const res = await app.inject({
            method: "PATCH",
            url: "/v1/projects/project-1/agent-messages/msg-1",
            headers: { "x-user-id": "user-1" },
            payload: { status: "resolved" },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('expected one of "unread"|"read"');
        expect(dbMock.agentMessage.update).not.toHaveBeenCalled();
        expect(state.messages[0]?.status).toBe("unread");
    });

    it("still allows read state updates", async () => {
        seedMessage({
            id: "msg-1",
            projectId: "project-1",
            accountId: "user-1",
            status: "unread",
        });
        app = await createApp();

        const res = await app.inject({
            method: "PATCH",
            url: "/v1/projects/project-1/agent-messages/msg-1",
            headers: { "x-user-id": "user-1" },
            payload: { status: "read" },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().message.status).toBe("read");
        expect(state.messages[0]?.status).toBe("read");
    });
});
