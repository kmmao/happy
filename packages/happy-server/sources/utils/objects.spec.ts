import { describe, it, expect } from "vitest";
import { mergeObjects } from "./objects";

describe("mergeObjects", () => {
    it("should merge updates into base object", () => {
        const base = { a: 1, b: 2 };
        const result = mergeObjects(base, { b: 3 });
        expect(result).toEqual({ a: 1, b: 3 });
    });

    it("should ignore undefined values in updates", () => {
        const base = { a: 1, b: 2, c: 3 };
        const result = mergeObjects(base, { a: undefined, b: 5 });
        expect(result).toEqual({ a: 1, b: 5, c: 3 });
    });

    it("should not mutate the base object", () => {
        const base = { a: 1, b: 2 };
        const result = mergeObjects(base, { b: 3 });
        expect(base.b).toBe(2);
        expect(result.b).toBe(3);
    });

    it("should handle empty updates", () => {
        const base = { a: 1, b: 2 };
        const result = mergeObjects(base, {});
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it("should handle all undefined updates", () => {
        const base = { a: 1, b: 2 };
        const result = mergeObjects(base, { a: undefined, b: undefined });
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it("should allow null values (only undefined is ignored)", () => {
        const base = { a: 1 as number | null, b: 2 };
        const result = mergeObjects(base, { a: null });
        expect(result).toEqual({ a: null, b: 2 });
    });

    it("should allow empty string values", () => {
        const base = { name: "alice" };
        const result = mergeObjects(base, { name: "" });
        expect(result).toEqual({ name: "" });
    });

    it("should allow zero values", () => {
        const base = { count: 5 };
        const result = mergeObjects(base, { count: 0 });
        expect(result).toEqual({ count: 0 });
    });
});
