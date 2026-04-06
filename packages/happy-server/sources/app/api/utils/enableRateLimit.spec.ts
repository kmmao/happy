import fastify from "fastify";
import {
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/utils/log", () => ({ log: vi.fn() }));

describe("enableRateLimit", () => {
    let app: ReturnType<typeof fastify>;

    afterEach(async () => {
        if (app) await app.close();
    });

    async function createAppWithRateLimit(opts: { max: number; timeWindow: number }) {
        const rateLimit = (await import("@fastify/rate-limit")).default;

        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);

        await app.register(rateLimit, {
            global: true,
            max: opts.max,
            timeWindow: opts.timeWindow,
        });

        app.get("/test", async () => ({ ok: true }));

        app.post("/auth", {
            config: { rateLimit: { max: 3, timeWindow: 60_000 } },
            schema: { body: z.object({ key: z.string() }) },
        }, async () => ({ ok: true }));

        await app.ready();
        return app;
    }

    it("allows requests under the global limit", async () => {
        app = await createAppWithRateLimit({ max: 5, timeWindow: 60_000 });

        const res = await app.inject({ method: "GET", url: "/test" });

        expect(res.statusCode).toBe(200);
        expect(res.headers["x-ratelimit-limit"]).toBe("5");
        expect(res.headers["x-ratelimit-remaining"]).toBe("4");
    });

    it("returns 429 when global rate limit is exceeded", async () => {
        app = await createAppWithRateLimit({ max: 3, timeWindow: 60_000 });

        for (let i = 0; i < 3; i++) {
            const res = await app.inject({ method: "GET", url: "/test" });
            expect(res.statusCode).toBe(200);
        }

        const res = await app.inject({ method: "GET", url: "/test" });

        expect(res.statusCode).toBe(429);
        expect(res.headers["retry-after"]).toBeDefined();
    });

    it("applies stricter per-route rate limit", async () => {
        app = await createAppWithRateLimit({ max: 100, timeWindow: 60_000 });

        // Auth route has max: 3
        for (let i = 0; i < 3; i++) {
            const res = await app.inject({
                method: "POST",
                url: "/auth",
                payload: { key: "test" },
            });
            expect(res.statusCode).toBe(200);
        }

        const res = await app.inject({
            method: "POST",
            url: "/auth",
            payload: { key: "test" },
        });

        expect(res.statusCode).toBe(429);
    });

    it("includes rate limit headers in responses", async () => {
        app = await createAppWithRateLimit({ max: 10, timeWindow: 60_000 });

        const res = await app.inject({ method: "GET", url: "/test" });

        expect(res.headers["x-ratelimit-limit"]).toBe("10");
        expect(res.headers["x-ratelimit-remaining"]).toBe("9");
        expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });

    it("tracks rate limits independently per route config", async () => {
        app = await createAppWithRateLimit({ max: 100, timeWindow: 60_000 });

        // Exhaust auth route limit (max: 3)
        for (let i = 0; i < 3; i++) {
            await app.inject({ method: "POST", url: "/auth", payload: { key: "test" } });
        }
        const authRes = await app.inject({ method: "POST", url: "/auth", payload: { key: "test" } });
        expect(authRes.statusCode).toBe(429);

        // Global route should still work
        const globalRes = await app.inject({ method: "GET", url: "/test" });
        expect(globalRes.statusCode).toBe(200);
    });
});

describe("enableRateLimit env var config", () => {
    it("exports correct default rate limit constants", async () => {
        const { AUTH_RATE_LIMIT, WEBHOOK_INBOUND_RATE_LIMIT } = await import("./enableRateLimit");

        expect(AUTH_RATE_LIMIT).toEqual({ max: 10, timeWindow: 60_000 });
        expect(WEBHOOK_INBOUND_RATE_LIMIT).toEqual({ max: 30, timeWindow: 60_000 });
    });
});
