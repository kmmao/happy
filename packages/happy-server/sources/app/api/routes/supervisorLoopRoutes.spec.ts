import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Fastify } from "../types";

const {
    dbMock,
    resolveSupervisorProfileMock,
    startLoopMock,
    resetState,
    seedProject,
    seedLoop,
} = vi.hoisted(() => {
    const state = {
        projects: [] as Array<{
            id: string;
            accountId: string;
            supervisorConfig: string | null;
        }>,
        loops: [] as Array<{
            id: string;
            projectId: string;
            accountId: string;
            status: string;
            currentPhase: string;
            currentIteration: number;
            maxIterations: number;
            costCapUsd: number | null;
            healthScoreTarget: number | null;
            autoApproveThreshold: number;
            maxConsecutiveFailures: number;
            maxDurationMinutes: number;
            totalCostUsd: number;
            totalTokens: number;
            totalActionsFound: number;
            totalActionsFixed: number;
            consecutiveFailures: number;
            initialHealthScore: number | null;
            currentHealthScore: number | null;
            activeRunId: string | null;
            exitReason: string | null;
            createdAt: Date;
            updatedAt: Date;
            completedAt: Date | null;
        }>,
    };

    const resetState = () => {
        state.projects = [];
        state.loops = [];
    };

    const seedProject = (input: {
        id: string;
        accountId: string;
        supervisorConfig?: string | null;
    }) => {
        state.projects.push({
            id: input.id,
            accountId: input.accountId,
            supervisorConfig: input.supervisorConfig ?? null,
        });
    };

    const seedLoop = (input: {
        id: string;
        projectId: string;
        accountId: string;
    }) => {
        const now = new Date();
        state.loops.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            status: "running",
            currentPhase: "analyzing",
            currentIteration: 1,
            maxIterations: 5,
            costCapUsd: null,
            healthScoreTarget: null,
            autoApproveThreshold: 80,
            maxConsecutiveFailures: 2,
            maxDurationMinutes: 240,
            totalCostUsd: 0,
            totalTokens: 0,
            totalActionsFound: 0,
            totalActionsFixed: 0,
            consecutiveFailures: 0,
            initialHealthScore: null,
            currentHealthScore: null,
            activeRunId: null,
            exitReason: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        });
    };

    const dbMock = {
        project: {
            findFirst: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                return (
                    state.projects.find(
                        (project) =>
                            project.id === where.id &&
                            project.accountId === where.accountId,
                    ) ?? null
                );
            }),
        },
        agentLoop: {
            findUnique: vi.fn(async (args: any) => {
                const loopId = args?.where?.id;
                return state.loops.find((loop) => loop.id === loopId) ?? null;
            }),
        },
    };

    const resolveSupervisorProfileMock = vi.fn(async () => ({
        runtimeProfile: {
            profileId: "openai",
            profileName: "OpenAI (GPT-5.4)",
            source: "built-in-profile",
            trust: "trusted",
            environmentVariables: {
                OPENAI_BASE_URL: "https://api.openai.com/v1",
            },
        },
    }));

    const startLoopMock = vi.fn(async () => ({ loopId: "loop-1" }));

    return {
        dbMock,
        resolveSupervisorProfileMock,
        startLoopMock,
        resetState,
        seedProject,
        seedLoop,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
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
vi.mock("@/modules/supervisorLoopEngine", () => ({
    startLoop: startLoopMock,
    pauseLoop: vi.fn(),
    resumeLoop: vi.fn(),
    stopLoop: vi.fn(),
}));

import { supervisorLoopRoutes } from "./supervisorLoopRoutes";

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

    supervisorLoopRoutes(typed);
    await typed.ready();
    return typed;
}

describe("supervisorLoopRoutes", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        resolveSupervisorProfileMock.mockClear();
        startLoopMock.mockClear();
        seedProject({ id: "proj-1", accountId: "user-1" });
        seedLoop({ id: "loop-1", projectId: "proj-1", accountId: "user-1" });
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("accepts a trusted built-in runtimeProfile payload for loop start", async () => {
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/supervisor/loop",
            headers: { "x-user-id": "user-1" },
            payload: {
                maxIterations: 3,
                autoApproveThreshold: 80,
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
        expect(startLoopMock).toHaveBeenCalledWith(
            "proj-1",
            "user-1",
            expect.objectContaining({
                maxIterations: 3,
                runtimeProfile: expect.objectContaining({
                    profileId: "openai",
                }),
            }),
        );
    });

    it("rejects non-built-in runtimeProfile payloads for loop start", async () => {
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/proj-1/supervisor/loop",
            headers: { "x-user-id": "user-1" },
            payload: {
                maxIterations: 3,
                autoApproveThreshold: 80,
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
        expect(startLoopMock).not.toHaveBeenCalled();
    });
});
