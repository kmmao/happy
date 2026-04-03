import { describe, expect, it } from "vitest";
import {
    commonDirectoryPrefix,
    formatIntervalMs,
    isValidTimeOfDay,
    normalizeMachineRootPath,
    parseDownstreamTriggers,
    parseIntervalMs,
    parseLineList,
    parsePositiveInteger,
} from "./loopsUtils";

describe("normalizeMachineRootPath", () => {
    it("trims and strips trailing slashes", () => {
        expect(normalizeMachineRootPath("  /foo/bar/  ")).toBe("/foo/bar");
    });

    it("normalizes backslashes", () => {
        expect(normalizeMachineRootPath("C:\\foo\\bar")).toBe("C:/foo/bar");
    });
});

describe("commonDirectoryPrefix", () => {
    it("returns full path for a single absolute path", () => {
        expect(commonDirectoryPrefix(["/Users/x/work/happy"])).toBe("/Users/x/work/happy");
    });

    it("returns shared parent for sibling repos", () => {
        expect(commonDirectoryPrefix(["/a/b/c", "/a/b/d"])).toBe("/a/b");
    });

    it("returns empty when paths diverge at root", () => {
        expect(commonDirectoryPrefix(["/a/x", "/b/y"])).toBe("");
    });

    it("returns empty for empty input", () => {
        expect(commonDirectoryPrefix([])).toBe("");
    });
});

describe("parseIntervalMs", () => {
    it("parses seconds", () => {
        expect(parseIntervalMs("30s")).toBe(30_000);
    });

    it("parses minutes", () => {
        expect(parseIntervalMs("10m")).toBe(600_000);
    });

    it("parses hours", () => {
        expect(parseIntervalMs("6h")).toBe(21_600_000);
    });

    it("parses days", () => {
        expect(parseIntervalMs("1d")).toBe(86_400_000);
    });

    it("returns null for invalid input", () => {
        expect(parseIntervalMs("abc")).toBeNull();
        expect(parseIntervalMs("")).toBeNull();
        expect(parseIntervalMs("10")).toBeNull();
    });

    it("trims whitespace", () => {
        expect(parseIntervalMs("  5m  ")).toBe(300_000);
    });
});

describe("formatIntervalMs", () => {
    it("formats days", () => {
        expect(formatIntervalMs(86_400_000)).toBe("1d");
    });

    it("formats hours", () => {
        expect(formatIntervalMs(3_600_000)).toBe("1h");
    });

    it("formats minutes", () => {
        expect(formatIntervalMs(600_000)).toBe("10m");
    });

    it("formats seconds", () => {
        expect(formatIntervalMs(5_000)).toBe("5s");
    });
});

describe("parsePositiveInteger", () => {
    it("returns undefined for empty string", () => {
        expect(parsePositiveInteger("")).toBeUndefined();
        expect(parsePositiveInteger("  ")).toBeUndefined();
    });

    it("returns null for non-numeric string", () => {
        expect(parsePositiveInteger("abc")).toBeNull();
    });

    it("returns null for zero", () => {
        expect(parsePositiveInteger("0")).toBeNull();
    });

    it("returns the number for positive integers", () => {
        expect(parsePositiveInteger("5")).toBe(5);
        expect(parsePositiveInteger("100")).toBe(100);
    });
});

describe("isValidTimeOfDay", () => {
    it("accepts valid times", () => {
        expect(isValidTimeOfDay("00:00")).toBe(true);
        expect(isValidTimeOfDay("23:59")).toBe(true);
        expect(isValidTimeOfDay("12:30")).toBe(true);
    });

    it("rejects invalid times", () => {
        expect(isValidTimeOfDay("24:00")).toBe(false);
        expect(isValidTimeOfDay("12:60")).toBe(false);
        expect(isValidTimeOfDay("abc")).toBe(false);
    });
});

describe("parseLineList", () => {
    it("returns undefined for empty input", () => {
        expect(parseLineList("")).toBeUndefined();
        expect(parseLineList("  \n  ")).toBeUndefined();
    });

    it("splits lines and trims", () => {
        expect(parseLineList("a\n  b  \nc")).toEqual(["a", "b", "c"]);
    });
});

describe("parseDownstreamTriggers", () => {
    it("returns undefined for empty input", () => {
        expect(parseDownstreamTriggers("")).toBeUndefined();
    });

    it("parses valid triggers", () => {
        expect(parseDownstreamTriggers("completed\nfailed")).toEqual(["completed", "failed"]);
    });

    it("returns null for invalid triggers", () => {
        expect(parseDownstreamTriggers("invalid")).toBeNull();
    });

    it("deduplicates triggers", () => {
        expect(parseDownstreamTriggers("completed\ncompleted")).toEqual(["completed"]);
    });
});
