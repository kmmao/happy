import { describe, it, expect } from "vitest";
import { safeParseJsonArray } from "./safeJson";

describe("safeParseJsonArray", () => {
    it("parses a JSON string array", () => {
        expect(safeParseJsonArray('["a","b"]')).toEqual(["a", "b"]);
    });
    it("returns [] for a non-array JSON value", () => {
        expect(safeParseJsonArray('{"a":1}')).toEqual([]);
        expect(safeParseJsonArray("42")).toEqual([]);
    });
    it("returns [] for malformed JSON", () => {
        expect(safeParseJsonArray("not json")).toEqual([]);
        expect(safeParseJsonArray("")).toEqual([]);
    });
});
