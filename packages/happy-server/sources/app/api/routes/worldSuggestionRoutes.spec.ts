import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fastify } from "../types";

const {
    dbMock,
    worldSuggestionAccept,
    worldSuggestionDismiss,
    worldSuggestionQuery,
    worldSuggestionRefresh,
    resetState,
    seedSuggestion,
} = vi.hoisted(() => {
    type SuggestionRecord = {
        id: string;
        accountId: string;
        projectId: string;
        relatedGoalId: string | null;
        relatedTaskId: string | null;
        type: string;
        title: string;
        summary: string;
        reason: string;
        evidence: string;
        recommendedRole: string | null;
        payload: string;
        requiresHuman: boolean;
        status: string;
        dedupeKey: string;
        createdAt: Date;
        actedAt: Date | null;
        bucket: string;
    };

    const state = {
        suggestions: [] as SuggestionRecord[],
    };

    const resetState = () => {
        state.suggestions = [];
    };

    const seedSuggestion = (input: Partial<SuggestionRecord> & Pick<SuggestionRecord, "id" | "accountId" | "projectId">) => {
        const now = new Date("2026-04-10T10:00:00Z");
        state.suggestions.push({
            id: input.id,
            accountId: input.accountId,
            projectId: input.projectId,
            relatedGoalId: input.relatedGoalId ?? null,
            relatedTaskId: input.relatedTaskId ?? null,
            type: input.type ?? "suggested_goal",
            title: input.title ?? "Create goal",
            summary: input.summary ?? "Need follow-up",
            reason: input.reason ?? "blocked",
            evidence: input.evidence ?? "[]",
            recommendedRole: input.recommendedRole ?? null,
            payload: input.payload ?? JSON.stringify({ goal: { title: "Create goal" } }),
            requiresHuman: input.requiresHuman ?? true,
            status: input.status ?? "open",
            dedupeKey: input.dedupeKey ?? `dedupe:${input.id}`,
            createdAt: input.createdAt ?? now,
            actedAt: input.actedAt ?? null,
            bucket: input.bucket ?? "next_step",
        });
    };

    const dbMock = {
        project: {
            findFirst: vi.fn(async ({ where }: any) => {
                if (where?.id === "project-1" && where?.accountId === "user-1") {
                    return { id: "project-1" };
                }
                return null;
            }),
        },
    };

    return {
        dbMock,
        worldSuggestionAccept: vi.fn(async ({ suggestionId }: any) => ({
            suggestionId,
            createdEntityType: "goal",
            createdEntityId: "goal-1",
            machineId: "machine-1",
        })),
        worldSuggestionDismiss: vi.fn(async () => undefined),
        worldSuggestionQuery: vi.fn(async (accountId: string, projectId: string, opts?: { status?: string; limit?: number; goalId?: string; bucket?: string }) => {
            const statuses = opts?.status === "open" ? ["open", "suspended"] : [opts?.status ?? "open"];
            return state.suggestions
                .filter((item) => item.accountId === accountId && item.projectId === projectId)
                .filter((item) => statuses.includes(item.status))
                .filter((item) => !opts?.goalId || item.relatedGoalId === opts.goalId)
                .filter((item) => !opts?.bucket || item.bucket === opts.bucket)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, opts?.limit ?? state.suggestions.length)
                .map((item) => ({
                    ...item,
                    evidence: JSON.parse(item.evidence),
                    payload: JSON.parse(item.payload),
                    createdAt: item.createdAt.getTime(),
                    actedAt: item.actedAt?.getTime() ?? null,
                }));
        }),
        worldSuggestionRefresh: vi.fn(async () => ({ created: 0, unchanged: 0, total: 0 })),
        resetState,
        seedSuggestion,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/modules/worldSuggestionAccept", () => ({ worldSuggestionAccept }));
vi.mock("@/modules/worldSuggestionDismiss", () => ({ worldSuggestionDismiss }));
vi.mock("@/modules/worldSuggestionQuery", () => ({ worldSuggestionQuery }));
vi.mock("@/modules/worldSuggestionGenerate", () => ({ worldSuggestionRefresh }));

import { worldSuggestionRoutes } from "./worldSuggestionRoutes";

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

    worldSuggestionRoutes(typed);
    await typed.ready();
    return typed;
}

describe("worldSuggestionRoutes suspended lifecycle", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
        seedSuggestion({
            id: "suggestion-suspended-1",
            accountId: "user-1",
            projectId: "project-1",
            status: "suspended",
            title: "Retry this goal",
        });
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("lists suspended suggestions in open query and allows dismiss and accept actions", async () => {
        app = await createApp();

        const listRes = await app.inject({
            method: "GET",
            url: "/v1/projects/project-1/world/suggestions?status=open",
            headers: { "x-user-id": "user-1" },
        });

        expect(listRes.statusCode).toBe(200);
        expect(listRes.json()).toEqual({
            suggestions: [
                expect.objectContaining({
                    id: "suggestion-suspended-1",
                    status: "suspended",
                    title: "Retry this goal",
                }),
            ],
        });
        expect(worldSuggestionQuery).toHaveBeenCalledWith("user-1", "project-1", { status: "open", limit: 50 });

        const dismissRes = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/world/suggestions/suggestion-suspended-1/dismiss",
            headers: { "x-user-id": "user-1" },
        });

        expect(dismissRes.statusCode).toBe(200);
        expect(dismissRes.json()).toEqual({ success: true });
        expect(worldSuggestionDismiss).toHaveBeenCalledWith("user-1", "project-1", "suggestion-suspended-1");

        const acceptRes = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/world/suggestions/suggestion-suspended-1/accept",
            headers: { "x-user-id": "user-1" },
            payload: {},
        });

        expect(acceptRes.statusCode).toBe(200);
        expect(acceptRes.json()).toEqual({
            suggestionId: "suggestion-suspended-1",
            createdEntityType: "goal",
            createdEntityId: "goal-1",
            machineId: "machine-1",
        });
        expect(worldSuggestionAccept).toHaveBeenCalledWith({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-suspended-1",
            machineId: undefined,
            priorityOverride: undefined,
            roleOverride: undefined,
        });
    });
});
