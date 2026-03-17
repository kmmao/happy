import { describe, it, expect } from "vitest";
import { delay } from "./delay";

describe("delay", () => {
    it("should resolve after specified time", async () => {
        const start = Date.now();
        await delay(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("should resolve immediately if signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        const start = Date.now();
        await delay(5000, controller.signal);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(50);
    });

    it("should resolve early when signal is aborted", async () => {
        const controller = new AbortController();

        setTimeout(() => controller.abort(), 30);

        const start = Date.now();
        await delay(5000, controller.signal);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200);
    });

    it("should work without a signal", async () => {
        await delay(10);
    });
});
