import { describe, it, expect } from "vitest";
import { uptime } from "./uptime";

describe("uptime", () => {
    it("should return a positive number", () => {
        const result = uptime();
        expect(result).toBeGreaterThan(0);
    });

    it("should return an integer (milliseconds)", () => {
        const result = uptime();
        expect(Number.isInteger(result)).toBe(true);
    });

    it("should increase over time", async () => {
        const first = uptime();
        await new Promise((r) => setTimeout(r, 50));
        const second = uptime();
        expect(second).toBeGreaterThanOrEqual(first);
    });
});
