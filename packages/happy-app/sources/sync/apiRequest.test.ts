import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthCredentials } from "@/auth/tokenStorage";

vi.mock("./serverConfig", () => ({
    getServerUrl: () => "https://api.test.com",
}));

// Run the backoff body once and surface its result/throw, so retry semantics
// don't slow the test while still exercising the real code path. Keep the rest
// of the module (e.g. NonRetryableError, used by throwIfNotOk) intact.
vi.mock("@/utils/time", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/time")>()),
    backoff: (fn: () => Promise<unknown>) => fn(),
}));

let apiRequest: typeof import("./apiRequest").apiRequest;
let apiRequestVoid: typeof import("./apiRequest").apiRequestVoid;
let apiRequestParsed: typeof import("./apiRequest").apiRequestParsed;

const credentials: AuthCredentials = { token: "test-token", secret: null };

function okJson(value: unknown) {
    return { ok: true, status: 200, json: vi.fn().mockResolvedValue(value) };
}

describe("apiRequest seam", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
        ({ apiRequest, apiRequestVoid, apiRequestParsed } = await import("./apiRequest"));
    });

    it("joins the base URL, attaches the bearer token, and parses JSON", async () => {
        global.fetch = vi.fn().mockResolvedValue(okJson({ value: 42 }) as never);

        const result = await apiRequest<{ value: number }>(credentials, "/v1/thing");

        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.test.com/v1/thing",
            expect.objectContaining({
                method: "GET",
                headers: { Authorization: "Bearer test-token" },
            }),
        );
        expect(result).toEqual({ value: 42 });
    });

    it("JSON-encodes the body and sets Content-Type for writes", async () => {
        global.fetch = vi.fn().mockResolvedValue(okJson({ ok: true }) as never);

        await apiRequest(credentials, "/v1/thing", {
            method: "POST",
            body: { name: "x" },
        });

        const [, init] = (global.fetch as any).mock.calls[0];
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
        });
        expect(JSON.parse(init.body)).toEqual({ name: "x" });
    });

    it("appends query parameters and skips undefined/null", async () => {
        global.fetch = vi.fn().mockResolvedValue(okJson([]) as never);

        await apiRequest(credentials, "/v1/list", {
            query: { prefix: "a", limit: 10, cursor: undefined, gone: null },
        });

        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.test.com/v1/list?prefix=a&limit=10",
            expect.anything(),
        );
    });

    it("throws via throwIfNotOk on a non-ok response", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            json: vi.fn(),
        } as never);

        await expect(
            apiRequest(credentials, "/v1/missing", { errorMessage: "boom" }),
        ).rejects.toThrow("boom: 404");
    });

    it("apiRequestVoid does not parse the body", async () => {
        const response = okJson({ should: "not be read" });
        global.fetch = vi.fn().mockResolvedValue(response as never);

        await apiRequestVoid(credentials, "/v1/thing", { method: "DELETE" });

        expect(response.json).not.toHaveBeenCalled();
        const [, init] = (global.fetch as any).mock.calls[0];
        expect(init.method).toBe("DELETE");
    });

    describe("apiRequestParsed", () => {
        const schema = z.object({ count: z.number() });

        it("returns the validated value when the response matches the schema", async () => {
            global.fetch = vi.fn().mockResolvedValue(okJson({ count: 7 }) as never);
            const result = await apiRequestParsed(credentials, "/v1/count", schema);
            expect(result).toEqual({ count: 7 });
        });

        it("throws a path-tagged error when the response fails validation", async () => {
            global.fetch = vi.fn().mockResolvedValue(okJson({ count: "nope" }) as never);
            await expect(
                apiRequestParsed(credentials, "/v1/count", schema),
            ).rejects.toThrow(/Invalid response from \/v1\/count/);
        });

        it("still surfaces the HTTP error (not a validation error) on a non-ok response", async () => {
            global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: vi.fn() } as never);
            await expect(
                apiRequestParsed(credentials, "/v1/count", schema, { errorMessage: "boom" }),
            ).rejects.toThrow("boom: 500");
        });
    });
});
