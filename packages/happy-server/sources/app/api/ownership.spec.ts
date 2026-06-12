import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, resetState, seedRow } = vi.hoisted(() => {
    const delegates = [
        "project",
        "session",
        "machine",
        "task",
        "artifact",
        "skill",
        "triggerSchedule",
        "webhookTrigger",
        "agentLoop",
        "supervisorRun",
        "supervisorAction",
        "supervisorDimension",
        "aiBackendProfile",
        "provisionToken",
        "webhookRoute",
    ] as const;

    type Row = { id: string; accountId: string; name: string };
    const state = {
        rows: {} as Record<string, Row[]>,
    };

    const resetState = () => {
        state.rows = {};
        for (const delegate of delegates) {
            state.rows[delegate] = [];
        }
    };
    resetState();

    const seedRow = (delegate: string, row: Row) => {
        state.rows[delegate].push(row);
    };

    const dbMock: Record<string, { findFirst: ReturnType<typeof vi.fn> }> = {};
    for (const delegate of delegates) {
        dbMock[delegate] = {
            findFirst: vi.fn(async (args: { where?: { id?: string; accountId?: string } }) => {
                const where = args?.where ?? {};
                return (
                    state.rows[delegate].find(
                        (row) => row.id === where.id && row.accountId === where.accountId,
                    ) ?? null
                );
            }),
        };
    }

    return { state, dbMock, resetState, seedRow };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));

import {
    OwnedEntityNotFound,
    assertOwnedProject,
    assertOwnedSession,
    assertOwnedMachine,
    assertOwnedArtifact,
    assertOwnedProvisionToken,
    ownedProject,
    ownedSession,
    ownedMachine,
    ownedTask,
    ownedArtifact,
    ownedSkill,
    ownedTriggerSchedule,
    ownedWebhookTrigger,
    ownedAgentLoop,
    ownedSupervisorRun,
    ownedSupervisorAction,
    ownedSupervisorDimension,
    ownedAiBackendProfile,
    ownedProvisionToken,
    ownedWebhookRoute,
} from "./ownership";
import { enableErrorHandlers } from "./utils/enableErrorHandlers";
import { type Fastify } from "./types";

// One entry per loader: [loader, Prisma delegate it queries, 404 label].
// The labels are wire-visible (clients and route specs assert the flat
// `{ error: "<label> not found" }` body), so a change here is a breaking
// API change, not a rename.
const LOADERS = [
    [ownedProject, "project", "Project"],
    [ownedSession, "session", "Session"],
    [ownedMachine, "machine", "Machine"],
    [ownedTask, "task", "Task"],
    [ownedArtifact, "artifact", "Artifact"],
    [ownedSkill, "skill", "Skill"],
    [ownedTriggerSchedule, "triggerSchedule", "Trigger schedule"],
    [ownedWebhookTrigger, "webhookTrigger", "Webhook trigger"],
    [ownedAgentLoop, "agentLoop", "Loop"],
    [ownedSupervisorRun, "supervisorRun", "Supervisor run"],
    [ownedSupervisorAction, "supervisorAction", "Action"],
    [ownedSupervisorDimension, "supervisorDimension", "Dimension"],
    [ownedAiBackendProfile, "aiBackendProfile", "Profile"],
    [ownedProvisionToken, "provisionToken", "Token"],
    [ownedWebhookRoute, "webhookRoute", "Route"],
] as const;

describe("ownership loaders", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    describe.each(LOADERS)("%o", (loader, delegate, label) => {
        it(`returns the row owned by the account (${delegate})`, async () => {
            seedRow(delegate, { id: "e1", accountId: "acc-1", name: "mine" });

            const row = await loader("acc-1", "e1");

            expect(row).toMatchObject({ id: "e1", accountId: "acc-1", name: "mine" });
            expect(dbMock[delegate].findFirst).toHaveBeenCalledWith({
                where: { id: "e1", accountId: "acc-1" },
            });
        });

        it(`throws OwnedEntityNotFound("${label}") when the row does not exist`, async () => {
            const promise = loader("acc-1", "missing");

            await expect(promise).rejects.toBeInstanceOf(OwnedEntityNotFound);
            await expect(promise).rejects.toMatchObject({
                message: `${label} not found`,
                statusCode: 404,
            });
        });

        it(`throws when the row belongs to another account (${delegate})`, async () => {
            seedRow(delegate, { id: "e1", accountId: "acc-other", name: "theirs" });

            await expect(loader("acc-1", "e1")).rejects.toBeInstanceOf(
                OwnedEntityNotFound,
            );
        });
    });
});

// Existence-only variants: same predicate and error mode, but they must fetch
// nothing (select: { id: true }) — that narrowing is the whole point of the
// variant, so it is asserted explicitly.
const ASSERTERS = [
    [assertOwnedProject, "project", "Project"],
    [assertOwnedSession, "session", "Session"],
    [assertOwnedMachine, "machine", "Machine"],
    [assertOwnedArtifact, "artifact", "Artifact"],
    [assertOwnedProvisionToken, "provisionToken", "Token"],
] as const;

describe("ownership existence asserters", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    describe.each(ASSERTERS)("%o", (asserter, delegate, label) => {
        it(`resolves and queries with select: { id: true } (${delegate})`, async () => {
            seedRow(delegate, { id: "e1", accountId: "acc-1", name: "mine" });

            await expect(asserter("acc-1", "e1")).resolves.toBeUndefined();
            expect(dbMock[delegate].findFirst).toHaveBeenCalledWith({
                where: { id: "e1", accountId: "acc-1" },
                select: { id: true },
            });
        });

        it(`throws OwnedEntityNotFound("${label}") on a miss`, async () => {
            const promise = asserter("acc-1", "missing");

            await expect(promise).rejects.toBeInstanceOf(OwnedEntityNotFound);
            await expect(promise).rejects.toMatchObject({
                message: `${label} not found`,
                statusCode: 404,
            });
        });

        it(`throws when the row belongs to another account (${delegate})`, async () => {
            seedRow(delegate, { id: "e1", accountId: "acc-other", name: "theirs" });

            await expect(asserter("acc-1", "e1")).rejects.toBeInstanceOf(
                OwnedEntityNotFound,
            );
        });
    });
});

describe("OwnedEntityNotFound wire mapping", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await app?.close();
    });

    it("enableErrorHandlers maps a thrown loader miss to the legacy flat 404 body", async () => {
        app = fastify() as unknown as Fastify;
        enableErrorHandlers(app);
        app.get("/probe/:id", async (request) => {
            const { id } = request.params as { id: string };
            await ownedProject("acc-1", id);
            return { ok: true };
        });
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/probe/nope" });

        expect(res.statusCode).toBe(404);
        // Flat legacy shape — NOT the apiError envelope ({ error: { code, … } }).
        expect(res.json()).toEqual({ error: "Project not found" });
    });

    it("does not intercept successful loads", async () => {
        seedRow("project", { id: "p1", accountId: "acc-1", name: "mine" });
        app = fastify() as unknown as Fastify;
        enableErrorHandlers(app);
        app.get("/probe/:id", async (request) => {
            const { id } = request.params as { id: string };
            const project = await ownedProject("acc-1", id);
            return { ok: true, name: (project as unknown as { name: string }).name };
        });
        await app.ready();

        const res = await app.inject({ method: "GET", url: "/probe/p1" });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, name: "mine" });
    });
});
