import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLog = vi.fn();
vi.mock("@/utils/log", () => ({ log: mockLog }));
vi.mock("./apiError", () => ({
    apiError: (code: string, message: string, extra?: object) => ({ error: code, message, ...extra }),
}));

describe("enableErrorHandlers - sanitizeHeaders", () => {
    it("redacts authorization header", async () => {
        const { sanitizeHeaders } = await import("./enableErrorHandlers");
        const result = sanitizeHeaders({ authorization: "Bearer secret-token" });
        expect(result["authorization"]).toBe("[REDACTED]");
        expect(result["authorization"]).not.toContain("secret-token");
    });

    it("redacts cookie header", async () => {
        const { sanitizeHeaders } = await import("./enableErrorHandlers");
        const result = sanitizeHeaders({ cookie: "session=abc123" });
        expect(result["cookie"]).toBe("[REDACTED]");
    });

    it("redacts set-cookie header", async () => {
        const { sanitizeHeaders } = await import("./enableErrorHandlers");
        const result = sanitizeHeaders({ "set-cookie": ["session=abc; HttpOnly"] });
        expect(result["set-cookie"]).toBe("[REDACTED]");
    });

    it("redacts x-happy-* headers", async () => {
        const { sanitizeHeaders } = await import("./enableErrorHandlers");
        const result = sanitizeHeaders({
            "x-happy-machine-id": "machine-secret",
            "x-happy-token": "tok-secret",
        });
        expect(result["x-happy-machine-id"]).toBe("[REDACTED]");
        expect(result["x-happy-token"]).toBe("[REDACTED]");
    });

    it("preserves non-sensitive headers", async () => {
        const { sanitizeHeaders } = await import("./enableErrorHandlers");
        const result = sanitizeHeaders({
            "user-agent": "test-agent/1.0",
            "content-type": "application/json",
            "accept": "application/json",
        });
        expect(result["user-agent"]).toBe("test-agent/1.0");
        expect(result["content-type"]).toBe("application/json");
        expect(result["accept"]).toBe("application/json");
    });
});

describe("enableErrorHandlers - 404 handler", () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(() => {
        mockLog.mockClear();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("does not log Authorization token in 404 handler", async () => {
        const { enableErrorHandlers } = await import("./enableErrorHandlers");
        app = fastify();
        enableErrorHandlers(app);
        await app.ready();

        await app.inject({
            method: "GET",
            url: "/nonexistent-path",
            headers: {
                authorization: "Bearer super-secret-token",
                "x-happy-machine-id": "machine-abc",
                "user-agent": "test/1.0",
            },
        });

        const notFoundCall = mockLog.mock.calls.find(
            (call) => (call[0] as Record<string, unknown>)?.module === "404-handler"
        );
        expect(notFoundCall).toBeDefined();

        const logCtx = notFoundCall![0] as Record<string, unknown>;
        const headersLogged = JSON.stringify(logCtx);
        expect(headersLogged).not.toContain("super-secret-token");
        expect(headersLogged).not.toContain("machine-abc");
        expect(headersLogged).toContain("[REDACTED]");
        expect(headersLogged).toContain("test/1.0");
    });

    it("404 handler logs method and url", async () => {
        const { enableErrorHandlers } = await import("./enableErrorHandlers");
        app = fastify();
        enableErrorHandlers(app);
        await app.ready();

        await app.inject({ method: "POST", url: "/unknown/route" });

        const notFoundCall = mockLog.mock.calls.find(
            (call) => (call[0] as Record<string, unknown>)?.module === "404-handler"
        );
        expect(notFoundCall).toBeDefined();
        const logCtx = notFoundCall![0] as Record<string, unknown>;
        expect(logCtx.method).toBe("POST");
        expect(logCtx.url).toBe("/unknown/route");
    });
});
