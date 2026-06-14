/**
 * Integration spec for the unified AgentLoop routes (ADR-0022 Phase 3b + 4).
 *
 * Exercises the route surface end-to-end through a real Fastify
 * instance, with the Prisma client + the engine modules + the sync
 * seam all mocked behind hoisted fakes. Covers:
 *
 *   - POST /v1/projects/:projectId/agent-loops      → create generic
 *   - GET  /v1/projects/:projectId/agent-loops      → role-aware list
 *   - GET  /v1/projects/:projectId/agent-loops/:id  → detail
 *   - PATCH                                          → generic update
 *   - DELETE                                         → role dispatch
 *   - POST /:id/{pause,resume,stop}                  → role dispatch
 *   - POST /:id/{enable,disable}                     → enabled toggle
 *
 * The full create/update DB calls go through inTx; we stub those so the
 * test exercises the route's body validation + dispatch instead of the
 * engine internals (which agentLoopEngine.test.ts covers separately).
 */

import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Fastify } from "../types";

const {
    dbMock,
    inTxMock,
    emitSyncUpdateMock,
    emitSyncEphemeralMock,
    supervisorPauseMock,
    supervisorResumeMock,
    supervisorStopMock,
    resetState,
    seedProject,
    seedLoop,
    state,
} = vi.hoisted(() => {
    const state = {
        projects: [] as Array<{ id: string; accountId: string }>,
        loops: [] as Array<{
            id: string;
            projectId: string;
            accountId: string;
            role: "generic" | "supervisor";
            status: string;
            enabled: boolean;
            agent: string | null;
            prompt: string | null;
            directory: string | null;
            intervalMs: number | null;
            cronExpression: string | null;
            iteration: number;
            nextRunAt: bigint | null;
            continuityKey: string | null;
            profileId: string | null;
            runtimeProfile: unknown;
            maxDurationMinutes: number;
            genericConfig: unknown;
            createdAt: Date;
            updatedAt: Date;
            completedAt: Date | null;
            // supervisor-only fillers (defaults so serializeAgentLoop is happy)
            currentPhase: string;
            currentIteration: number;
            maxIterations: number;
            costCapUsd: number | null;
            healthScoreTarget: number | null;
            autoApproveThreshold: number;
            maxConsecutiveFailures: number;
            emptyIterationsToConfirm: number;
            consecutiveEmptyIterations: number;
            initialHealthScore: number | null;
            currentHealthScore: number | null;
            totalCostUsd: number;
            totalTokens: number;
            totalActionsFound: number;
            totalActionsFixed: number;
            consecutiveFailures: number;
            activeRunId: string | null;
            exitReason: string | null;
        }>,
    };

    const resetState = () => {
        state.projects = [];
        state.loops = [];
    };

    const seedProject = (input: { id: string; accountId: string }) => {
        state.projects.push(input);
    };

    const seedLoop = (input: {
        id: string;
        projectId: string;
        accountId: string;
        role?: "generic" | "supervisor";
        status?: string;
        enabled?: boolean;
        prompt?: string;
        directory?: string;
        intervalMs?: number;
        cronExpression?: string;
    }) => {
        const now = new Date();
        state.loops.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            role: input.role ?? "generic",
            status: input.status ?? "running",
            enabled: input.enabled ?? true,
            agent: input.role === "supervisor" ? null : "claude",
            prompt: input.prompt ?? (input.role === "supervisor" ? null : "do the thing"),
            directory: input.directory ?? (input.role === "supervisor" ? null : "/tmp/proj"),
            intervalMs: input.intervalMs ?? 60_000,
            cronExpression: input.cronExpression ?? null,
            iteration: 0,
            nextRunAt: BigInt(now.getTime() + 60_000),
            continuityKey: null,
            profileId: null,
            runtimeProfile: null,
            maxDurationMinutes: 240,
            genericConfig: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            currentPhase: "idle",
            currentIteration: 0,
            maxIterations: 5,
            costCapUsd: null,
            healthScoreTarget: null,
            autoApproveThreshold: 80,
            maxConsecutiveFailures: 2,
            emptyIterationsToConfirm: 2,
            consecutiveEmptyIterations: 0,
            initialHealthScore: null,
            currentHealthScore: null,
            totalCostUsd: 0,
            totalTokens: 0,
            totalActionsFound: 0,
            totalActionsFixed: 0,
            consecutiveFailures: 0,
            activeRunId: null,
            exitReason: null,
        });
    };

    const matchesWhere = (loop: any, where: any): boolean => {
        if (!where) return true;
        for (const key of Object.keys(where)) {
            if (key === "AND" || key === "OR" || key === "project") continue;
            const value = where[key];
            if (value !== null && typeof value === "object" && "in" in value) {
                if (!(value.in as any[]).includes(loop[key])) return false;
            } else if (value === null) {
                if (loop[key] !== null) return false;
            } else if (loop[key] !== value) {
                return false;
            }
        }
        return true;
    };

    const dbMock = {
        project: {
            findFirst: vi.fn(async (args: any) => {
                const w = args?.where ?? {};
                return (
                    state.projects.find(
                        (p) => p.id === w.id && p.accountId === w.accountId,
                    ) ?? null
                );
            }),
        },
        agentLoop: {
            findUnique: vi.fn(async (args: any) => {
                return state.loops.find((l) => l.id === args?.where?.id) ?? null;
            }),
            findFirst: vi.fn(async (args: any) => {
                return state.loops.find((l) => matchesWhere(l, args?.where ?? {})) ?? null;
            }),
            findMany: vi.fn(async (args: any) => {
                return state.loops
                    .filter((l) => matchesWhere(l, args?.where ?? {}))
                    .slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? 100));
            }),
            count: vi.fn(async (args: any) => {
                return state.loops.filter((l) => matchesWhere(l, args?.where ?? {})).length;
            }),
            create: vi.fn(async (args: any) => {
                const data = args?.data ?? {};
                const now = new Date();
                const created = {
                    ...state.loops[0], // pick a row shape to inherit defaults
                    ...data,
                    id: data.id ?? `loop-${state.loops.length + 1}`,
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null,
                };
                state.loops.push(created);
                return created;
            }),
            update: vi.fn(async (args: any) => {
                const idx = state.loops.findIndex((l) => l.id === args?.where?.id);
                if (idx === -1) throw new Error("not found");
                const updated = {
                    ...state.loops[idx],
                    ...(args?.data ?? {}),
                    updatedAt: new Date(),
                };
                state.loops[idx] = updated;
                return updated;
            }),
            updateMany: vi.fn(async () => ({ count: 1 })),
            delete: vi.fn(async (args: any) => {
                const idx = state.loops.findIndex((l) => l.id === args?.where?.id);
                if (idx === -1) throw new Error("not found");
                const [removed] = state.loops.splice(idx, 1);
                return removed;
            }),
        },
    };

    const inTxMock = vi.fn(async (fn: any) => fn(dbMock));
    const emitSyncUpdateMock = vi.fn(async () => undefined);
    const emitSyncEphemeralMock = vi.fn(async () => undefined);
    const supervisorPauseMock = vi.fn(async () => ({ success: true }));
    const supervisorResumeMock = vi.fn(async () => ({ success: true }));
    const supervisorStopMock = vi.fn(async () => ({ success: true }));

    return {
        dbMock,
        inTxMock,
        emitSyncUpdateMock,
        emitSyncEphemeralMock,
        supervisorPauseMock,
        supervisorResumeMock,
        supervisorStopMock,
        resetState,
        seedProject,
        seedLoop,
        state,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/storage/inTx", () => ({ inTx: inTxMock, afterTx: vi.fn() }));
vi.mock("@/app/events/syncUpdate", () => ({ emitSyncUpdate: emitSyncUpdateMock }));
vi.mock("@/app/events/syncEphemeral", () => ({ emitSyncEphemeral: emitSyncEphemeralMock }));
vi.mock("@/modules/supervisorLoopEngine", () => ({
    pauseLoop: supervisorPauseMock,
    resumeLoop: supervisorResumeMock,
    stopLoop: supervisorStopMock,
}));

import { agentLoopRoutes } from "./agentLoopRoutes";

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

    agentLoopRoutes(typed);
    await typed.ready();
    return typed;
}

describe("agentLoopRoutes — Phase 3b/4 unified surface", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        emitSyncUpdateMock.mockClear();
        emitSyncEphemeralMock.mockClear();
        supervisorPauseMock.mockClear();
        supervisorResumeMock.mockClear();
        supervisorStopMock.mockClear();
        supervisorPauseMock.mockResolvedValue({ success: true });
        supervisorResumeMock.mockResolvedValue({ success: true });
        supervisorStopMock.mockResolvedValue({ success: true });
        seedProject({ id: "proj-1", accountId: "user-1" });
        seedLoop({ id: "loop-generic", projectId: "proj-1", accountId: "user-1", role: "generic" });
        seedLoop({ id: "loop-supervisor", projectId: "proj-1", accountId: "user-1", role: "supervisor" });
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("GET list with no role returns BOTH supervisor + generic rows", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "GET",
            url: "/v1/projects/proj-1/agent-loops",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.total).toBe(2);
        const ids = body.loops.map((l: any) => l.id).sort();
        expect(ids).toEqual(["loop-generic", "loop-supervisor"]);
    });

    it("GET list with role=generic narrows to generic rows only", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "GET",
            url: "/v1/projects/proj-1/agent-loops?role=generic",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.total).toBe(1);
        expect(body.loops[0].id).toBe("loop-generic");
    });

    it("GET list with role=supervisor narrows to supervisor rows only", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "GET",
            url: "/v1/projects/proj-1/agent-loops?role=supervisor",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().total).toBe(1);
        expect(res.json().loops[0].id).toBe("loop-supervisor");
    });

    it("GET detail returns either role through the unified path", async () => {
        app = await createApp();
        for (const id of ["loop-generic", "loop-supervisor"]) {
            const res = await app.inject({
                method: "GET",
                url: `/v1/projects/proj-1/agent-loops/${id}`,
                headers: { "x-user-id": "user-1" },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().loop.id).toBe(id);
        }
    });

    it("POST create rejects when neither intervalMs nor cronExpression is provided", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops",
            headers: { "x-user-id": "user-1" },
            payload: {
                prompt: "do",
                directory: "/tmp",
                agent: "claude",
            },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("intervalMs or cronExpression");
    });

    it("POST create persists a generic-role loop", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops",
            headers: { "x-user-id": "user-1" },
            payload: {
                prompt: "nightly cleanup",
                directory: "/tmp/work",
                intervalMs: 60_000,
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().loop.role).toBe("generic");
        expect(res.json().loop.prompt).toBe("nightly cleanup");
        expect(emitSyncUpdateMock).toHaveBeenCalled();
    });

    it("DELETE on a supervisor row that is running returns 409", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "DELETE",
            url: "/v1/projects/proj-1/agent-loops/loop-supervisor",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toContain("Stop it first");
    });

    it("DELETE on a stopped supervisor row succeeds", async () => {
        // Manually flip the seeded supervisor row to a non-active status.
        const sup = state.loops.find((l) => l.id === "loop-supervisor")!;
        sup.status = "stopped";
        app = await createApp();
        const res = await app.inject({
            method: "DELETE",
            url: "/v1/projects/proj-1/agent-loops/loop-supervisor",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().deleted).toBe(true);
    });

    it("POST /pause on a supervisor loop dispatches to supervisorLoopEngine", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-supervisor/pause",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        expect(supervisorPauseMock).toHaveBeenCalledWith("loop-supervisor", "user-1");
    });

    it("POST /pause on a generic loop flips enabled=false via the engine helper", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/pause",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        // Supervisor engine should NOT have been called for a generic row.
        expect(supervisorPauseMock).not.toHaveBeenCalled();
        // The generic engine emits SyncUpdate on success.
        expect(emitSyncUpdateMock).toHaveBeenCalled();
        // And the row in our fake DB had enabled flipped.
        const row = state.loops.find((l) => l.id === "loop-generic")!;
        expect(row.enabled).toBe(false);
    });

    it("POST /resume on a generic loop sets enabled=true and recomputes nextRunAt", async () => {
        // Pause the generic row first so resume has work to do.
        const row = state.loops.find((l) => l.id === "loop-generic")!;
        row.enabled = false;
        row.nextRunAt = null;
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/resume",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        expect(supervisorResumeMock).not.toHaveBeenCalled();
        const after = state.loops.find((l) => l.id === "loop-generic")!;
        expect(after.enabled).toBe(true);
        expect(after.nextRunAt).not.toBeNull();
    });

    it("POST /stop on a generic loop marks status=stopped + exitReason=user_stopped", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/stop",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        const after = state.loops.find((l) => l.id === "loop-generic")!;
        expect(after.status).toBe("stopped");
        expect(after.exitReason).toBe("user_stopped");
        expect(after.enabled).toBe(false);
    });

    it("POST /stop on a supervisor loop dispatches to supervisorLoopEngine.stopLoop", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-supervisor/stop",
            headers: { "x-user-id": "user-1" },
        });
        expect(res.statusCode).toBe(200);
        expect(supervisorStopMock).toHaveBeenCalledWith("loop-supervisor", "user-1");
    });

    it("POST /enable + /disable toggle the generic loop's enabled flag", async () => {
        app = await createApp();

        const disable = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/disable",
            headers: { "x-user-id": "user-1" },
        });
        expect(disable.statusCode).toBe(200);
        expect(state.loops.find((l) => l.id === "loop-generic")!.enabled).toBe(false);

        const enable = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/enable",
            headers: { "x-user-id": "user-1" },
        });
        expect(enable.statusCode).toBe(200);
        expect(state.loops.find((l) => l.id === "loop-generic")!.enabled).toBe(true);
    });

    it("PATCH on a generic loop updates the prompt and reschedules nextRunAt", async () => {
        app = await createApp();
        const before = state.loops.find((l) => l.id === "loop-generic")!;
        const oldNextRunAt = before.nextRunAt;

        const res = await app.inject({
            method: "PATCH",
            url: "/v1/projects/proj-1/agent-loops/loop-generic",
            headers: { "x-user-id": "user-1" },
            payload: { prompt: "updated prompt", intervalMs: 120_000 },
        });
        expect(res.statusCode).toBe(200);
        const after = state.loops.find((l) => l.id === "loop-generic")!;
        expect(after.prompt).toBe("updated prompt");
        expect(after.intervalMs).toBe(120_000);
        // Schedule changed → nextRunAt should have been recomputed.
        expect(after.nextRunAt).not.toBe(oldNextRunAt);
    });

    it("iteration callback rejects without a Bearer token", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/iterations",
            payload: { iteration: 1, status: "completed" },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().error).toContain("Bearer");
    });

    it("iteration callback rejects an invalid Bearer token", async () => {
        app = await createApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/agent-loops/loop-generic/iterations",
            headers: { authorization: "Bearer not-the-real-token" },
            payload: { iteration: 1, status: "completed" },
        });
        expect(res.statusCode).toBe(401);
    });
});
