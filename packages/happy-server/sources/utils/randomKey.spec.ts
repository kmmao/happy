import { describe, it, expect } from "vitest";
import { randomKey } from "./randomKey";
import { randomKeyNaked } from "./randomKeyNaked";

describe("randomKey", () => {
    it("should generate a key with the given prefix", () => {
        const key = randomKey("test");
        expect(key.startsWith("test_")).toBe(true);
    });

    it("should generate a key with default length of 24 chars after prefix", () => {
        const key = randomKey("pfx");
        const body = key.slice("pfx_".length);
        expect(body.length).toBe(24);
    });

    it("should generate a key with custom length", () => {
        const key = randomKey("pfx", 10);
        const body = key.slice("pfx_".length);
        expect(body.length).toBe(10);
    });

    it("should only contain alphanumeric characters after prefix", () => {
        const key = randomKey("test");
        const body = key.slice("test_".length);
        expect(body).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it("should generate unique keys", () => {
        const keys = new Set(Array.from({ length: 100 }, () => randomKey("u")));
        expect(keys.size).toBe(100);
    });
});

describe("randomKeyNaked", () => {
    it("should generate a key without prefix", () => {
        const key = randomKeyNaked();
        expect(key).not.toContain("_");
    });

    it("should generate a key with default length of 24", () => {
        const key = randomKeyNaked();
        expect(key.length).toBe(24);
    });

    it("should generate a key with custom length", () => {
        const key = randomKeyNaked(12);
        expect(key.length).toBe(12);
    });

    it("should only contain alphanumeric characters", () => {
        const key = randomKeyNaked();
        expect(key).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it("should generate unique keys", () => {
        const keys = new Set(
            Array.from({ length: 100 }, () => randomKeyNaked()),
        );
        expect(keys.size).toBe(100);
    });
});
