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
