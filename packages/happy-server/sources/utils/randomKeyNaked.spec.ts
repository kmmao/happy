import { describe, it, expect } from "vitest";
import { randomKeyNaked } from "./randomKeyNaked";

describe("randomKeyNaked", () => {
    it("should generate a key of default length (24)", () => {
        const key = randomKeyNaked();
        expect(key).toHaveLength(24);
    });

    it("should generate a key of specified length", () => {
        const key = randomKeyNaked(10);
        expect(key).toHaveLength(10);
    });

    it("should only contain alphanumeric characters", () => {
        for (let i = 0; i < 20; i++) {
            const key = randomKeyNaked(32);
            expect(key).toMatch(/^[a-zA-Z0-9]+$/);
        }
    });

    it("should generate unique keys", () => {
        const keys = new Set<string>();
        for (let i = 0; i < 100; i++) {
            keys.add(randomKeyNaked());
        }
        expect(keys.size).toBe(100);
    });

    it("should handle small lengths", () => {
        const key = randomKeyNaked(1);
        expect(key).toHaveLength(1);
        expect(key).toMatch(/^[a-zA-Z0-9]$/);
    });
});
