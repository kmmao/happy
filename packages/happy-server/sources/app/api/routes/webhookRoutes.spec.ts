import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type WebhookRouteRecord = {
    id: string;
    accountId: string;
    provider: string;
    repoUrl: string;
    webhookSecret: Buffer;
    apiToken: Buffer | null;
    labels: string[];
    authors: string[];
    machineId: string;
    repoPath: string;
    enabled: boolean;
    remoteWebhookId: string | null;
    createdAt: Date;
};

type WebhookEventRecord = {
    id: string;
    accountId: string;
    provider: string;
    repoUrl: string;
    issueNumber: number | null;
    issueTitle: string | null;
    issueUrl: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
};

const {
    dbMock,
    dispatchWebhookMock,
    ensureRemoteWebhookMock,
    deleteRemoteWebhookMock,
    resetState,
    seedRoute,
    seedEvent,
} = vi.hoisted(() => {
    const state = {
        routes: [] as WebhookRouteRecord[],
        events: [] as WebhookEventRecord[],
        nextRouteId: 1,
    };

    const resetState = () => {
        state.routes = [];
        state.events = [];
        state.nextRouteId = 1;
    };

    const seedRoute = (input: Partial<WebhookRouteRecord> & Pick<WebhookRouteRecord, "accountId" | "repoUrl">) => {
        const r: WebhookRouteRecord = {
            id: input.id ?? `route-${state.nextRouteId++}`,
            accountId: input.accountId,
            provider: input.provider ?? "github",
            repoUrl: input.repoUrl,
            webhookSecret: input.webhookSecret ?? Buffer.from("secret"),
            apiToken: input.apiToken ?? null,
            labels: input.labels ?? [],
            authors: input.authors ?? [],
            machineId: input.machineId ?? "machine-1",
            repoPath: input.repoPath ?? "/repo",
            enabled: input.enabled ?? true,
            remoteWebhookId: input.remoteWebhookId ?? null,
            createdAt: input.createdAt ?? new Date(),
        };
        state.routes.push(r);
        return r;
    };

    const seedEvent = (input: Partial<WebhookEventRecord> & Pick<WebhookEventRecord, "accountId">) => {
        state.events.push({
            id: input.id ?? `event-${state.events.length + 1}`,
            accountId: input.accountId,
            provider: input.provider ?? "github",
            repoUrl: input.repoUrl ?? "https://github.com/test/repo",
            issueNumber: input.issueNumber ?? null,
            issueTitle: input.issueTitle ?? null,
            issueUrl: input.issueUrl ?? null,
            status: input.status ?? "dispatched",
            errorMessage: input.errorMessage ?? null,
            createdAt: input.createdAt ?? new Date(),
        });
    };

    const dbMock = {
        webhookRoute: {
            findMany: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                return state.routes.filter((r) => r.accountId === where.accountId);
            }),
            findFirst: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                return state.routes.find(
                    (r) => r.id === where.id && r.accountId === where.accountId,
                ) ?? null;
            }),
            upsert: vi.fn(async (args: any) => {
                const create = args?.create ?? {};
                const r: WebhookRouteRecord = {
                    id: `route-${state.nextRouteId++}`,
                    accountId: create.accountId,
                    provider: create.provider,
                    repoUrl: create.repoUrl,
                    webhookSecret: create.webhookSecret,
                    apiToken: create.apiToken ?? null,
                    labels: create.labels ?? [],
                    authors: create.authors ?? [],
                    machineId: create.machineId,
                    repoPath: create.repoPath,
                    enabled: create.enabled ?? true,
                    remoteWebhookId: null,
                    createdAt: new Date(),
                };
                state.routes.push(r);
                return r;
            }),
            update: vi.fn(async () => ({})),
            delete: vi.fn(async (args: any) => {
                const idx = state.routes.findIndex((r) => r.id === args?.where?.id);
                if (idx >= 0) state.routes.splice(idx, 1);
            }),
        },
        webhookEvent: {
            findMany: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                let rows = state.events.filter((e) => e.accountId === where.accountId);
                if (where.repoUrl) rows = rows.filter((e) => e.repoUrl === where.repoUrl);
                rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                if (args?.skip) rows = rows.slice(args.skip);
                if (args?.take) rows = rows.slice(0, args.take);
                return rows;
            }),
            count: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                let rows = state.events.filter((e) => e.accountId === where.accountId);
                if (where.repoUrl) rows = rows.filter((e) => e.repoUrl === where.repoUrl);
                return rows.length;
            }),
        },
        project: {
            findFirst: vi.fn(async () => null),
        },
    };

    const dispatchWebhookMock = vi.fn(async () => ({ dispatched: true, reason: undefined }));
    const ensureRemoteWebhookMock = vi.fn(async () => null);
    const deleteRemoteWebhookMock = vi.fn(async () => {});

    return {
        state,
        dbMock,
        dispatchWebhookMock,
        ensureRemoteWebhookMock,
        deleteRemoteWebhookMock,
        resetState,
        seedRoute,
        seedEvent,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/modules/encrypt", () => ({
    encryptString: vi.fn(() => new Uint8Array([1, 2, 3])),
    decryptString: vi.fn(() => "decrypted-token"),
}));
vi.mock("@/app/webhook/webhookDispatch", () => ({
    dispatchWebhook: dispatchWebhookMock,
}));
vi.mock("@/app/webhook/webhookProviderApi", () => ({
    ensureRemoteWebhook: ensureRemoteWebhookMock,
    deleteRemoteWebhook: deleteRemoteWebhookMock,
}));

import { webhookRoutes } from "./webhookRoutes";

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

    // Add rawBody support for webhook endpoint
    typed.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
        try {
            (req as any).rawBody = body;
            done(null, JSON.parse(body as string));
        } catch (err) {
            done(err as Error, undefined);
        }
    });

    webhookRoutes(typed);
    await typed.ready();
    return typed;
}

describe("webhookRoutes", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        dispatchWebhookMock.mockClear();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    describe("POST /v1/webhooks/:provider", () => {
        it("receives a webhook and returns 200", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/webhooks/github",
                payload: { action: "opened" },
                headers: { "x-github-event": "issues" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ received: true });
            expect(dispatchWebhookMock).toHaveBeenCalledTimes(1);
        });

        it("returns 200 even when dispatch throws", async () => {
            dispatchWebhookMock.mockRejectedValueOnce(new Error("fail"));
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/webhooks/github",
                payload: { action: "opened" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ received: true });
        });

        it("rejects invalid provider", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/webhooks/bitbucket",
                payload: {},
            });

            expect(res.statusCode).toBe(400);
        });
    });

    describe("GET /v1/webhooks/routes", () => {
        it("lists routes for the authenticated user", async () => {
            seedRoute({ accountId: "user-1", repoUrl: "https://github.com/a/b" });
            seedRoute({ accountId: "user-1", repoUrl: "https://github.com/c/d" });
            seedRoute({ accountId: "user-2", repoUrl: "https://github.com/e/f" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/webhooks/routes",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toHaveLength(2);
        });

        it("returns 401 without auth", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/webhooks/routes",
            });

            expect(res.statusCode).toBe(401);
        });
    });

    describe("POST /v1/webhooks/routes", () => {
        it("creates a new webhook route", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "POST",
                url: "/v1/webhooks/routes",
                headers: { "x-user-id": "user-1" },
                payload: {
                    provider: "github",
                    repoUrl: "https://github.com/test/repo",
                    webhookSecret: "my-secret",
                    labels: ["auto-fix"],
                    authors: [],
                    machineId: "m1",
                    repoPath: "/home/user/repo",
                    enabled: true,
                },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json().repoUrl).toBeDefined();
        });
    });

    describe("DELETE /v1/webhooks/routes/:id", () => {
        it("deletes an existing route", async () => {
            const route = seedRoute({ id: "r1", accountId: "user-1", repoUrl: "https://github.com/a/b" });
            app = await createApp();

            const res = await app.inject({
                method: "DELETE",
                url: `/v1/webhooks/routes/${route.id}`,
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ deleted: true });
        });

        it("returns 404 for non-existent route", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "DELETE",
                url: "/v1/webhooks/routes/no-such",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(404);
        });
    });

    describe("GET /v1/webhooks/events", () => {
        it("lists events for the user", async () => {
            seedEvent({ accountId: "user-1", provider: "github" });
            seedEvent({ accountId: "user-1", provider: "gitea" });
            seedEvent({ accountId: "user-2", provider: "github" });
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/webhooks/events",
                headers: { "x-user-id": "user-1" },
            });

            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.events).toHaveLength(2);
            expect(body.total).toBe(2);
        });

        it("returns 401 without auth", async () => {
            app = await createApp();

            const res = await app.inject({
                method: "GET",
                url: "/v1/webhooks/events",
            });

            expect(res.statusCode).toBe(401);
        });
    });
});
