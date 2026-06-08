import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type SessionRecord = {
    id: string;
    accountId: string;
    tag: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
    projectId: string | null;
};

const {
    state,
    dbMock,
    emitUpdateMock,
    resetState,
    seedSession,
    missSessionLookupById,
    missSessionLookupByTag,
} = vi.hoisted(() => {
    const state = {
        sessions: [] as SessionRecord[],
        nextSeq: 1,
        missById: new Set<string>(),
        missByTag: new Set<string>(),
    };

    const resetState = () => {
        state.sessions = [];
        state.nextSeq = 1;
        state.missById = new Set();
        state.missByTag = new Set();
    };

    const seedSession = (
        input: Partial<SessionRecord> & Pick<SessionRecord, "id" | "accountId" | "tag">,
    ) => {
        const now = new Date();
        state.sessions.push({
            id: input.id,
            accountId: input.accountId,
            tag: input.tag,
            seq: input.seq ?? 0,
            metadata: input.metadata ?? "encrypted-meta",
            metadataVersion: input.metadataVersion ?? 1,
            agentState: input.agentState ?? null,
            agentStateVersion: input.agentStateVersion ?? 0,
            dataEncryptionKey: input.dataEncryptionKey ?? null,
            active: input.active ?? true,
            lastActiveAt: input.lastActiveAt ?? now,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
            projectId: input.projectId ?? null,
        });
    };

    const missSessionLookupById = (sessionId: string) => {
        state.missById.add(sessionId);
    };

    const missSessionLookupByTag = (accountId: string, tag: string) => {
        state.missByTag.add(`${accountId}:${tag}`);
    };

    const sessionFindFirst = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (typeof where.id === "string" && typeof where.accountId === "string") {
            if (state.missById.has(where.id)) {
                state.missById.delete(where.id);
                return null;
            }
            return state.sessions.find(
                (session) => session.id === where.id && session.accountId === where.accountId,
            ) ?? null;
        }

        if (typeof where.tag === "string" && typeof where.accountId === "string") {
            const missKey = `${where.accountId}:${where.tag}`;
            if (state.missByTag.has(missKey)) {
                state.missByTag.delete(missKey);
                return null;
            }
            return state.sessions.find(
                (session) => session.tag === where.tag && session.accountId === where.accountId,
            ) ?? null;
        }

        return null;
    });

    const sessionCreate = vi.fn(async (args: any) => {
        const now = new Date();
        const data = args?.data ?? {};
        const session: SessionRecord = {
            id: data.id ?? `session-${state.sessions.length + 1}`,
            accountId: data.accountId,
            tag: data.tag,
            seq: 0,
            metadata: data.metadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            dataEncryptionKey: data.dataEncryptionKey ?? null,
            active: true,
            lastActiveAt: now,
            createdAt: now,
            updatedAt: now,
            projectId: null,
        };
        state.sessions.push(session);
        return session;
    });

    const sessionUpdate = vi.fn(async (args: any) => {
        const session = state.sessions.find((item) => item.id === args?.where?.id);
        if (!session) {
            throw new Error("Session not found");
        }
        Object.assign(session, args?.data ?? {}, { updatedAt: new Date() });
        return session;
    });

    const dbMock = {
        session: {
            findFirst: sessionFindFirst,
            create: sessionCreate,
            update: sessionUpdate,
        },
        project: {
            findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })),
        },
        $queryRaw: vi.fn(async () => [{ id: "project-1" }]),
    };

    const emitUpdateMock = vi.fn();

    return {
        state,
        dbMock,
        emitUpdateMock,
        resetState,
        seedSession,
        missSessionLookupById,
        missSessionLookupByTag,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/utils/randomKeyNaked", () => ({ randomKeyNaked: vi.fn(() => "update-id") }));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => state.nextSeq++) }));
vi.mock("@/app/session/sessionDelete", () => ({ sessionDelete: vi.fn() }));
vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: {
        invalidateSession: vi.fn(),
    },
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitUpdateInternal: emitUpdateMock },
    buildNewSessionUpdate: vi.fn((_session: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-session" },
    })),
    buildNewProjectUpdate: vi.fn((_project: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-project" },
    })),
}));

import { sessionRoutes } from "./sessionRoutes";

function createP2002Error() {
    const error = new Error("Unique constraint failed");
    (error as { code?: string }).code = "P2002";
    return error;
}

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

    sessionRoutes(typed);
    await typed.ready();
    return typed;
}

describe("sessionRoutes", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        emitUpdateMock.mockClear();
        dbMock.session.findFirst.mockClear();
        dbMock.session.create.mockClear();
        dbMock.session.update.mockClear();
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    describe("POST /v1/sessions", () => {
        it("uses the pre-allocated sessionId as tag for missing reconnect sessions", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/sessions",
                headers: { "x-user-id": "user-1" },
                payload: {
                    sessionId: "fork-session-1",
                    tag: "reconnect",
                    metadata: "encrypted-meta",
                },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.session.id).toBe("fork-session-1");
            expect(body.session.tag).toBe("fork-session-1");
            expect(state.sessions).toHaveLength(1);
            expect(state.sessions[0].tag).toBe("fork-session-1");
            expect(emitUpdateMock).toHaveBeenCalledTimes(1);
        });

        it("recovers from duplicate pre-allocated session creation instead of returning 500", async () => {
            seedSession({
                id: "fork-session-2",
                accountId: "user-1",
                tag: "fork-session-2",
            });
            missSessionLookupById("fork-session-2");
            dbMock.session.create.mockImplementationOnce(async () => {
                throw createP2002Error();
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/sessions",
                headers: { "x-user-id": "user-1" },
                payload: {
                    sessionId: "fork-session-2",
                    tag: "reconnect",
                    metadata: "encrypted-meta",
                },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.session.id).toBe("fork-session-2");
            expect(body.session.tag).toBe("fork-session-2");
            expect(emitUpdateMock).not.toHaveBeenCalled();
        });

        it("recovers from duplicate tag creation races by returning the existing session", async () => {
            seedSession({
                id: "session-1",
                accountId: "user-1",
                tag: "shared-tag",
            });
            missSessionLookupByTag("user-1", "shared-tag");
            dbMock.session.create.mockImplementationOnce(async () => {
                throw createP2002Error();
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/sessions",
                headers: { "x-user-id": "user-1" },
                payload: {
                    tag: "shared-tag",
                    metadata: "encrypted-meta",
                },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.session.id).toBe("session-1");
            expect(body.session.tag).toBe("shared-tag");
            expect(emitUpdateMock).not.toHaveBeenCalled();
        });
    });
});
