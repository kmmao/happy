import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import type { Fastify } from "../types";

const { dbMock, decisionAdjudicate, log } = vi.hoisted(() => ({
    dbMock: {
        project: {
            findFirst: vi.fn(async () => ({ id: "project-1" })),
        },
        decision: {
            findFirst: vi.fn(),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
        },
    },
    decisionAdjudicate: vi.fn(),
    log: vi.fn(),
}));

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/modules/decisionCreate", () => ({ decisionCreate: vi.fn() }));
vi.mock("@/modules/decisionAdjudicate", () => ({ decisionAdjudicate }));
vi.mock("@/modules/decisionMatch", () => ({ matchPrecedent: vi.fn(async () => null) }));
vi.mock("@/utils/log", () => ({ log }));

import { decisionRoutes } from "./decisionRoutes";

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

    decisionRoutes(typed);
    await typed.ready();
    return typed;
}

describe("decisionRoutes POST /v1/projects/:id/decisions/:decisionId/adjudicate", () => {
    let app: Fastify;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 400 for unknown chosen option", async () => {
        decisionAdjudicate.mockRejectedValueOnce(new Error("Invalid decision option"));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/decisions/decision-1/adjudicate",
            headers: { "x-user-id": "user-1" },
            payload: { chosenOption: "missing-option" },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("Invalid decision option");
        await app.close();
    });

    it("returns 404 when decision is already resolved", async () => {
        decisionAdjudicate.mockRejectedValueOnce(new Error("Decision not found or already resolved"));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/decisions/decision-1/adjudicate",
            headers: { "x-user-id": "user-1" },
            payload: { chosenOption: "option-1" },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().error).toBe("Decision not found or already resolved");
        await app.close();
    });

    it("returns 500 for invalid stored decision options", async () => {
        decisionAdjudicate.mockRejectedValueOnce(new Error("Decision options are invalid"));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/decisions/decision-1/adjudicate",
            headers: { "x-user-id": "user-1" },
            payload: { chosenOption: "option-1" },
        });

        expect(res.statusCode).toBe(500);
        expect(res.json().error).toBe("Decision options are invalid");
        await app.close();
    });

    it("returns generic 500 for unexpected adjudication failures", async () => {
        decisionAdjudicate.mockRejectedValueOnce(new Error("database unavailable"));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/projects/project-1/decisions/decision-1/adjudicate",
            headers: { "x-user-id": "user-1" },
            payload: { chosenOption: "option-1" },
        });

        expect(res.statusCode).toBe(500);
        expect(res.json().error).toBe("Internal server error");
        expect(log).toHaveBeenCalledWith(
            { module: "decision", level: "error" },
            "Failed to adjudicate decision decision-1: database unavailable",
        );
        await app.close();
    });
});
