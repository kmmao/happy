import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type ProjectRecord = {
    id: string;
    accountId: string;
    machineId: string | null;
    path: string | null;
    supervisorMode: string | null;
    supervisorEnabledDimensions: string | null;
    supervisorCustomRules: string | null;
    supervisorConfig: string | null;
    supervisorConfigVersion: number;
    supervisorScheduleEnabled: boolean;
    supervisorScheduleIntervalHours: number;
    supervisorPushTriggerEnabled: boolean;
    supervisorNotifyPrefs: string | null;
    supervisorNextRunAt: Date | null;
    fixStrategy: string | null;
    repoUrl: string | null;
};

type RunRecord = {
    id: string;
    projectId: string;
    accountId: string;
    trigger: string;
    status: string;
    artifactId: string | null;
    reportTitle: string | null;
    reportContent: string | null;
    researchParams: string | null;
    actionsCount: number;
    issuesCreated: number;
    sessionId: string | null;
    errorMessage: string | null;
    tokenCount: number | null;
    costUsd: number | null;
    healthScore: number | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
};

const {
    dbMock,
    emitEphemeralMock,
    resolveSupervisorProfileMock,
    authCreateSupervisorCallbackTokenMock,
    resetState,
    seedProject,
    seedRun,
} = vi.hoisted(() => {
    const state = {
        projects: [] as ProjectRecord[],
        runs: [] as RunRecord[],
        nextRunId: 1,
    };

    const resetState = () => {
        state.projects = [];
        state.runs = [];
        state.nextRunId = 1;
    };

    const seedProject = (input: Partial<ProjectRecord> & Pick<ProjectRecord, "id" | "accountId">) => {
        state.projects.push({
            id: input.id,
            accountId: input.accountId,
            machineId: input.machineId ?? "default-machine",
            path: input.path ?? "/repo",
            supervisorMode: input.supervisorMode ?? "suggest",
            supervisorEnabledDimensions: input.supervisorEnabledDimensions ?? null,
            supervisorCustomRules: input.supervisorCustomRules ?? null,
            supervisorConfig: input.supervisorConfig ?? null,
            supervisorConfigVersion: input.supervisorConfigVersion ?? 1,
            supervisorScheduleEnabled: input.supervisorScheduleEnabled ?? false,
            supervisorScheduleIntervalHours: input.supervisorScheduleIntervalHours ?? 24,
            supervisorPushTriggerEnabled: input.supervisorPushTriggerEnabled ?? false,
            supervisorNotifyPrefs: input.supervisorNotifyPrefs ?? null,
            supervisorNextRunAt: input.supervisorNextRunAt ?? null,
            fixStrategy: input.fixStrategy ?? null,
            repoUrl: input.repoUrl ?? null,
        });
    };

    const seedRun = (input: Partial<RunRecord> & Pick<RunRecord, "id" | "projectId" | "accountId">) => {
        const now = new Date();
        state.runs.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            trigger: input.trigger ?? "manual",
            status: input.status ?? "completed",
            artifactId: input.artifactId ?? null,
            reportTitle: input.reportTitle ?? null,
            reportContent: input.reportContent ?? null,
            researchParams: input.researchParams ?? null,
            actionsCount: input.actionsCount ?? 0,
            issuesCreated: input.issuesCreated ?? 0,
            sessionId: input.sessionId ?? null,
            errorMessage: input.errorMessage ?? null,
            tokenCount: input.tokenCount ?? null,
            costUsd: input.costUsd ?? null,
            healthScore: input.healthScore ?? null,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
            completedAt: input.completedAt ?? null,
        });
    };

    const selectFields = <T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) => {
        if (!select) return { ...row };
        const picked: Record<string, unknown> = {};
        for (const [key, enabled] of Object.entries(select)) {
            if (enabled) picked[key] = row[key];
        }
        return picked;
    };

    const dbMock = {
        project: {
            findFirst: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                const p = state.projects.find((p) => p.id === where.id && p.accountId === where.accountId);
                if (!p) return null;
                return selectFields(p as unknown as Record<string, unknown>, args?.select);
            }),
            findUnique: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                const p = state.projects.find((p) => p.id === where.id);
                if (!p) return null;
                return selectFields(p as unknown as Record<string, unknown>, args?.select);
            }),
            update: vi.fn(async (args: any) => {
                const p = state.projects.find((p) => p.id === args?.where?.id);
                if (!p) throw new Error("Not found");
                const data = args?.data ?? {};
                Object.assign(p, data);
                if (data.supervisorConfigVersion?.increment) {
                    p.supervisorConfigVersion += data.supervisorConfigVersion.increment;
                }
                return p;
            }),
        },
        webhookRoute: {
            findFirst: vi.fn(async () => null),
        },
        supervisorRun: {
            findFirst: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                const r = state.runs.find((r) => {
                    if (where.id && r.id !== where.id) return false;
                    if (where.projectId && r.projectId !== where.projectId) return false;
                    if (where.accountId && r.accountId !== where.accountId) return false;
                    if (where.status?.in && !where.status.in.includes(r.status)) return false;
                    return true;
                });
                if (!r) return null;
                return selectFields(r as unknown as Record<string, unknown>, args?.select);
            }),
            findMany: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                let rows = state.runs.filter((r) => {
                    if (where.projectId && r.projectId !== where.projectId) return false;
                    if (where.accountId && r.accountId !== where.accountId) return false;
                    if (where.trigger && r.trigger !== where.trigger) return false;
                    return true;
                });
                rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                if (args?.skip) rows = rows.slice(args.skip);
                if (args?.take) rows = rows.slice(0, args.take);
                return rows.map((r) => selectFields(r as unknown as Record<string, unknown>, args?.select));
            }),
            findUnique: vi.fn(async (args: any) => state.runs.find((r) => r.id === args?.where?.id) ?? null),
            count: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                return state.runs.filter((r) => {
                    if (where.projectId && r.projectId !== where.projectId) return false;
                    if (where.accountId && r.accountId !== where.accountId) return false;
                    if (where.trigger && r.trigger !== where.trigger) return false;
                    return true;
                }).length;
            }),
            create: vi.fn(async (args: any) => {
                const now = new Date();
                const data = args?.data ?? {};
                const run: RunRecord = {
                    id: `run-${state.nextRunId++}`,
                    projectId: data.projectId,
                    accountId: data.accountId,
                    trigger: data.trigger ?? "manual",
                    status: data.status ?? "pending",
                    artifactId: null,
                    reportTitle: null,
                    reportContent: null,
                    researchParams: data.researchParams ?? null,
                    actionsCount: 0,
                    issuesCreated: 0,
                    sessionId: null,
                    errorMessage: null,
                    tokenCount: null,
                    costUsd: null,
                    healthScore: null,
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null,
                };
                state.runs.push(run);
                return run;
            }),
            updateMany: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                let count = 0;
                for (const r of state.runs) {
                    if (where.id && r.id !== where.id) continue;
                    if (where.projectId && r.projectId !== where.projectId) continue;
                    if (where.accountId && r.accountId !== where.accountId) continue;
                    if (where.status?.in && !where.status.in.includes(r.status)) continue;
                    const data = args?.data ?? {};
                    if (data.status) r.status = data.status;
                    if (data.completedAt) r.completedAt = data.completedAt;
                    count++;
                }
                return { count };
            }),
            update: vi.fn(async (args: any) => {
                const r = state.runs.find((r) => r.id === args?.where?.id);
                if (!r) throw new Error("Not found");
                Object.assign(r, args?.data ?? {});
                return r;
            }),
        },
        supervisorAction: {
            findFirst: vi.fn(async () => null),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
            createMany: vi.fn(async () => ({ count: 0 })),
            update: vi.fn(async () => ({})),
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        supervisorLoop: {
            findFirst: vi.fn(async () => null),
        },
        session: {
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock)),
    };

    const emitEphemeralMock = vi.fn();
    const resolveSupervisorProfileMock = vi.fn(async (): Promise<{
        runtimeProfile?: {
            profileId?: string;
            profileName?: string;
            source: string;
            trust: string;
            environmentVariables: Record<string, string>;
        };
    }> => ({
        runtimeProfile: undefined,
    }));
    const authCreateSupervisorCallbackTokenMock = vi.fn(async () => "callback-token");

    return {
        dbMock,
        emitEphemeralMock,
        resolveSupervisorProfileMock,
        authCreateSupervisorCallbackTokenMock,
        resetState,
        seedProject,
        seedRun,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/modules/supervisorLimits", () => ({
    checkDailyRunLimit: vi.fn(async () => ({ allowed: true, currentCount: 0, limit: 10 })),
    incrementDailyRunCount: vi.fn(async () => {}),
}));
vi.mock("@/modules/supervisorScoring", () => ({
    computeHealthScore: vi.fn(() => 85),
    countSeverities: vi.fn(() => ({ critical: 0, high: 0, medium: 0, low: 0 })),
}));
vi.mock("@/modules/supervisorUsage", () => ({
    aggregateSessionUsage: vi.fn(async () => null),
}));
vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: { invalidateSession: vi.fn() },
}));
// PR 1.5.f: build*Ephemeral functions moved into syncEphemeral.ts as private
// helpers. We mock only the transport sink and assert on the wire payload
// that reaches it.
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitEphemeralInternal: emitEphemeralMock },
}));
vi.mock("@/modules/supervisorProfileResolver", () => ({
    resolveSupervisorProfile: resolveSupervisorProfileMock,
    parseDefaultProfileId: vi.fn((config: string | null) => {
        if (!config) return null;
        try {
            const parsed = JSON.parse(config) as { defaultProfileId?: string | null };
            return parsed.defaultProfileId ?? null;
        } catch {
            return null;
        }
    }),
}));
vi.mock("@/app/auth/auth", () => ({
    auth: {
        createSupervisorCallbackToken: authCreateSupervisorCallbackTokenMock,
    },
}));
vi.mock("@/app/webhook/webhookProviderApi", () => ({
    createIssueOnProvider: vi.fn(async () => null),
}));
vi.mock("@/modules/encrypt", () => ({
    decryptString: vi.fn(() => "decrypted-token"),
}));
vi.mock("@/modules/knowledgeContributor", () => ({
    contributeSupervisorKnowledge: vi.fn(async () => {}),
}));
vi.mock("@/modules/inboxCreate", () => ({
    inboxCreate: vi.fn(async () => {}),
}));
vi.mock("@/modules/pushSend", () => ({
    pushSupervisorNotification: vi.fn(async () => {}),
}));

import { supervisorRoutes } from "./supervisorRoutes";
import { supervisorRunRoutes } from "./supervisorRunRoutes";
import { supervisorActionRoutes } from "./supervisorActionRoutes";
import { handleAutoApproval } from "../supervisor/supervisorAutoApproval";

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
    typed.decorate("authenticateMachineScopedCallback", async () => {});

    supervisorRoutes(typed);
    supervisorRunRoutes(typed);
    supervisorActionRoutes(typed);
    await typed.ready();
    return typed;
}

describe("supervisorRoutes", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        emitEphemeralMock.mockClear();
        emitEphemeralMock.mockClear();
        resolveSupervisorProfileMock.mockReset();
        resolveSupervisorProfileMock.mockResolvedValue({
            runtimeProfile: undefined,
        });
        authCreateSupervisorCallbackTokenMock.mockClear();
        dbMock.supervisorAction.findFirst.mockReset();
        dbMock.supervisorAction.findFirst.mockResolvedValue(null);
        dbMock.supervisorAction.findMany.mockReset();
        dbMock.supervisorAction.findMany.mockResolvedValue([]);
        dbMock.supervisorAction.count.mockReset();
        dbMock.supervisorAction.count.mockResolvedValue(0);
        dbMock.supervisorAction.updateMany.mockReset();
        dbMock.supervisorAction.updateMany.mockResolvedValue({ count: 0 });
        dbMock.supervisorLoop.findFirst.mockReset();
        dbMock.supervisorLoop.findFirst.mockResolvedValue(null);
        dbMock.webhookRoute.findFirst.mockReset();
        dbMock.webhookRoute.findFirst.mockResolvedValue(null);
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    describe("POST /v1/projects/:id/supervisor/run", () => {
        it("creates a pending run and emits trigger event", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {},
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.run.status).toBe("pending");
            expect(body.run.projectId).toBe("proj-1");
            expect(emitEphemeralMock).toHaveBeenCalledTimes(1);
        });

        it("emits resolved profile on manual run trigger", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                machineId: "machine-1",
                supervisorConfig: JSON.stringify({ defaultProfileId: "profile-1" }),
            });
            resolveSupervisorProfileMock.mockResolvedValueOnce({
                runtimeProfile: {
                    profileId: "profile-1",
                    profileName: "Profile 1",
                    source: "account-profile",
                    trust: "trusted",
                    environmentVariables: { OPENAI_API_KEY: "sk-test" },
                },
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {},
            });

            expect(res.statusCode).toBe(200);
            expect(resolveSupervisorProfileMock).toHaveBeenCalledWith("user-1", "profile-1");
            expect(authCreateSupervisorCallbackTokenMock).toHaveBeenCalledWith({
                userId: "user-1",
                projectId: "proj-1",
                machineId: "machine-1",
                purpose: "run-status",
                runId: "run-1",
            });
            expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                        callbackToken: "callback-token",
                        runtimeProfile: expect.objectContaining({
                            profileId: "profile-1",
                            environmentVariables: { OPENAI_API_KEY: "sk-test" },
                        }),
                    
                }),
            }),
        );
        });

        it("accepts a trusted built-in runtimeProfile payload on manual run trigger", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                machineId: "machine-1",
            });
            resolveSupervisorProfileMock.mockResolvedValueOnce({
                runtimeProfile: {
                    profileId: "openai",
                    profileName: "OpenAI (GPT-5.4)",
                    source: "built-in-profile",
                    trust: "trusted",
                    environmentVariables: { OPENAI_BASE_URL: "https://api.openai.com/v1" },
                },
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {
                    runtimeProfile: {
                        profileId: "openai",
                        profileName: "OpenAI (GPT-5.4)",
                        source: "built-in-profile",
                        trust: "trusted",
                        isBuiltIn: true,
                        environmentVariables: {
                            OPENAI_BASE_URL: "https://api.openai.com/v1",
                        },
                    },
                },
            });

            expect(res.statusCode).toBe(200);
            expect(resolveSupervisorProfileMock).toHaveBeenCalledWith("user-1", "openai");
            expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                        runtimeProfile: expect.objectContaining({
                            profileId: "openai",
                        }),
                    
                }),
            }),
        );
        });

        it("rejects non-built-in runtimeProfile payloads on manual run trigger", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                machineId: "machine-1",
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {
                    runtimeProfile: {
                        profileId: "profile-1",
                        profileName: "Profile 1",
                        source: "account-profile",
                        trust: "trusted",
                        environmentVariables: {},
                    },
                },
            });

            expect(res.statusCode).toBe(400);
            expect(resolveSupervisorProfileMock).not.toHaveBeenCalled();
        });

        it("returns 404 for non-existent project", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/no-such/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {},
            });

            expect(res.statusCode).toBe(404);
        });

        it("returns 409 when a run is already in progress", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            seedRun({ id: "run-existing", projectId: "proj-1", accountId: "user-1", status: "running" });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                headers: { "x-user-id": "user-1" },
                payload: {},
            });

            expect(res.statusCode).toBe(409);
            expect(res.json().error).toContain("already in progress");
        });

        it("returns 401 without auth", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/run",
                payload: {},
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("GET /v1/projects/:id/supervisor/runs", () => {
        it("lists runs with pagination", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            seedRun({ id: "r1", projectId: "proj-1", accountId: "user-1", status: "completed" });
            seedRun({ id: "r2", projectId: "proj-1", accountId: "user-1", status: "completed" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/projects/proj-1/supervisor/runs?limit=10&offset=0",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.runs).toHaveLength(2);
            expect(body.total).toBe(2);
        });

        it("returns 404 for non-existent project", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/projects/no-such/supervisor/runs",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });
    });

    describe("GET /v1/projects/:id/supervisor/runs/:runId", () => {
        it("returns a single run", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            seedRun({ id: "r1", projectId: "proj-1", accountId: "user-1", status: "completed" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/projects/proj-1/supervisor/runs/r1",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json().run.id).toBe("r1");
        });

        it("returns 404 for non-existent run", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/projects/proj-1/supervisor/runs/no-such",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });
    });

    describe("POST /v1/projects/:id/supervisor/cancel/:runId", () => {
        it("cancels an active run", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            seedRun({ id: "r1", projectId: "proj-1", accountId: "user-1", status: "running" });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/cancel/r1",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            expect(emitEphemeralMock).toHaveBeenCalledTimes(1);
        });

        it("returns 404 when no active run found", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            seedRun({ id: "r1", projectId: "proj-1", accountId: "user-1", status: "completed" });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/cancel/r1",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });
    });

    describe("PATCH /v1/projects/:id/supervisor/config", () => {
        it("updates supervisor configuration", async () => {
            seedProject({ id: "proj-1", accountId: "user-1" });
            app = await createApp();

            const res = await app.inject({
                method: "PATCH",
                url: "/v1/projects/proj-1/supervisor/config",
                headers: { "x-user-id": "user-1" },
                payload: {
                    supervisorConfig: "new-config",
                    supervisorMode: "auto",
                },
            });

            expect(res.statusCode).toBe(200);
        });

        it("returns 404 for non-existent project", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "PATCH",
                url: "/v1/projects/no-such/supervisor/config",
                headers: { "x-user-id": "user-1" },
                payload: { supervisorConfig: "config" },
            });

            expect(res.statusCode).toBe(404);
        });
    });

    describe("profile inheritance for fixes", () => {
        it("emits resolved profile when manual fix trigger is created", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                supervisorConfig: JSON.stringify({ defaultProfileId: "profile-1", analyzeAutoFix: true }),
                fixStrategy: "pr",
            });
            dbMock.supervisorAction.findFirst.mockResolvedValueOnce({
                id: "action-1",
                runId: "run-1",
                projectId: "proj-1",
                accountId: "user-1",
                confidence: 0.9,
                approval: "approved",
                fixStatus: null,
                fixMode: null,
                fixSessionId: null,
                issueUrl: null,
                lastSeenRunId: null,
                title: "Fix thing",
                description: "desc",
                suggestedFix: "suggest",
                category: "deps",
                severity: "high",
                createdAt: new Date("2026-04-16T00:00:00.000Z"),
                updatedAt: new Date("2026-04-16T00:00:00.000Z"),
            } as any);
            resolveSupervisorProfileMock.mockResolvedValueOnce({
                runtimeProfile: {
                    profileId: "profile-1",
                    profileName: "Profile 1",
                    source: "account-profile",
                    trust: "trusted",
                    environmentVariables: { ANTHROPIC_API_KEY: "test-key" },
                },
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/actions/action-1/fix",
                headers: { "x-user-id": "user-1" },
                payload: { mode: "analyze-first" },
            });

            if (res.statusCode !== 200) {
                throw new Error(res.body);
            }
            expect(resolveSupervisorProfileMock).toHaveBeenCalledWith("user-1", "profile-1");
            expect(authCreateSupervisorCallbackTokenMock).toHaveBeenCalledWith({
                userId: "user-1",
                projectId: "proj-1",
                machineId: "default-machine",
                purpose: "fix-status",
                actionId: "action-1",
            });
            expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                        callbackToken: "callback-token",
                        runtimeProfile: expect.objectContaining({
                            profileId: "profile-1",
                            environmentVariables: { ANTHROPIC_API_KEY: "test-key" },
                        }),
                        fixMode: "analyze-first",
                        analyzeAutoFix: true,
                    
                }),
            }),
        );
        });

        it("emits resolved profile when auto approval triggers fix", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                supervisorMode: "auto",
                machineId: "machine-1",
                path: "/repo",
                supervisorConfig: JSON.stringify({
                    defaultProfileId: "profile-1",
                    autoApprove: { auto: ["high"] },
                    concurrency: { maxAnalysisSessions: 2, maxFixSessions: 1 },
                }),
                fixStrategy: "pr",
            });
            dbMock.supervisorAction.findMany.mockResolvedValueOnce([
                {
                    id: "action-1",
                    severity: "high",
                    title: "Fix thing",
                    description: "desc",
                    suggestedFix: "suggest",
                    category: "deps",
                },
            ] as any);
            resolveSupervisorProfileMock.mockResolvedValueOnce({
                runtimeProfile: {
                    profileId: "profile-1",
                    profileName: "Profile 1",
                    source: "account-profile",
                    trust: "trusted",
                    environmentVariables: { OPENAI_API_KEY: "sk-test" },
                },
            });

            await handleAutoApproval("user-1", "proj-1", "run-1");

            expect(resolveSupervisorProfileMock).toHaveBeenCalledWith("user-1", "profile-1");
            expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                        runtimeProfile: expect.objectContaining({
                            profileId: "profile-1",
                            environmentVariables: { OPENAI_API_KEY: "sk-test" },
                        }),
                        runId: "action-1",
                        trigger: "fix",
                    
                }),
            }),
        );
        });

        it("emits resolved profile when reprocess triggers fixes", async () => {
            seedProject({
                id: "proj-1",
                accountId: "user-1",
                machineId: "machine-1",
                path: "/repo",
                supervisorConfig: JSON.stringify({
                    defaultProfileId: "profile-1",
                    autoApprove: { autoSeverities: ["high"] },
                    concurrency: { maxAnalysisSessions: 2, maxFixSessions: 1 },
                }),
                fixStrategy: "pr",
            });
            dbMock.supervisorAction.findMany.mockResolvedValueOnce([
                {
                    id: "action-1",
                    severity: "high",
                    title: "Fix thing",
                    description: "desc",
                    suggestedFix: "suggest",
                    category: "deps",
                },
            ] as any);
            dbMock.supervisorAction.count.mockResolvedValueOnce(0);
            resolveSupervisorProfileMock.mockResolvedValueOnce({
                runtimeProfile: {
                    profileId: "profile-1",
                    profileName: "Profile 1",
                    source: "account-profile",
                    trust: "trusted",
                    environmentVariables: { OPENAI_API_KEY: "sk-test" },
                },
            });
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/projects/proj-1/supervisor/actions/reprocess",
                headers: { "x-user-id": "user-1" },
                payload: { mode: "auto" },
            });

            if (res.statusCode !== 200) {
                throw new Error(res.body);
            }
            expect(resolveSupervisorProfileMock).toHaveBeenCalledWith("user-1", "profile-1");
            expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: "supervisor-trigger",
                        projectId: "proj-1",
                        runId: "action-1",
                        trigger: "fix",
                        callbackToken: "callback-token",
                        runtimeProfile: expect.objectContaining({
                            profileId: "profile-1",
                            environmentVariables: { OPENAI_API_KEY: "sk-test" },
                        }),
                    
                }),
            }),
        );
        });
    });
});
