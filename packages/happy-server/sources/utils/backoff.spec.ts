import { describe, it, expect } from "vitest";
import { createBackoff } from "./backoff";

describe("createBackoff", () => {
    it("should return the result on first successful call", async () => {
        const backoff = createBackoff({ minDelay: 1, maxDelay: 10 });
        const result = await backoff(async () => 42);
        expect(result).toBe(42);
    });

    it("should retry on failure and eventually succeed", async () => {
        const backoff = createBackoff({ minDelay: 1, maxDelay: 10 });
        let attempt = 0;
        const result = await backoff(async () => {
            attempt++;
            if (attempt < 3) throw new Error("transient");
            return "success";
        });

        expect(result).toBe("success");
        expect(attempt).toBe(3);
    });

    it("should use custom options", async () => {
        const backoff = createBackoff({
            minDelay: 1,
            maxDelay: 5,
            factor: 0.1,
        });

        let attempt = 0;
        const start = Date.now();
        await backoff(async () => {
            attempt++;
            if (attempt < 2) throw new Error("fail");
            return "ok";
        });

        expect(attempt).toBe(2);
        expect(Date.now() - start).toBeLessThan(500);
    });

    it("should return different types", async () => {
        const backoff = createBackoff({ minDelay: 1, maxDelay: 10 });

        const str = await backoff(async () => "hello");
        expect(str).toBe("hello");

        const arr = await backoff(async () => [1, 2, 3]);
        expect(arr).toEqual([1, 2, 3]);

        const obj = await backoff(async () => ({ key: "value" }));
        expect(obj).toEqual({ key: "value" });
    });
});
