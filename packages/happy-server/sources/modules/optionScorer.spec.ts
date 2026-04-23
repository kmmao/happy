import { describe, it, expect } from "vitest";
import { parseScores, buildUserMessage } from "./optionScorer";

describe("optionScorer", () => {
    describe("parseScores", () => {
        it("parses valid JSON array", () => {
            expect(parseScores("[80, 60, 40]", 3)).toEqual([80, 60, 40]);
        });

        it("parses array embedded in text", () => {
            expect(parseScores("Here are the scores: [90, 70, 50] done.", 3)).toEqual([90, 70, 50]);
        });

        it("clamps values to 0-100", () => {
            expect(parseScores("[150, -10, 50]", 3)).toEqual([100, 0, 50]);
        });

        it("rounds floating point values", () => {
            expect(parseScores("[85.7, 42.3, 10.5]", 3)).toEqual([86, 42, 11]);
        });

        it("returns null for wrong count", () => {
            expect(parseScores("[80, 60]", 3)).toBeNull();
        });

        it("returns null for non-array JSON", () => {
            expect(parseScores('{"score": 80}', 1)).toBeNull();
        });

        it("returns null for non-numeric elements", () => {
            expect(parseScores('["high", "low"]', 2)).toBeNull();
        });

        it("returns null for no JSON in text", () => {
            expect(parseScores("I cannot score these options.", 2)).toBeNull();
        });

        it("returns null for empty string", () => {
            expect(parseScores("", 1)).toBeNull();
        });

        it("handles single-element array", () => {
            expect(parseScores("[75]", 1)).toEqual([75]);
        });
    });

    describe("buildUserMessage", () => {
        it("builds message with context and options", () => {
            const result = buildUserMessage(
                ["Fix the bug", "Run tests"],
                "- User: please fix\n- Agent: I found the issue",
                "Debug auth flow",
            );
            expect(result).toContain("Context:");
            expect(result).toContain("- User: please fix");
            expect(result).toContain("Task: Debug auth flow");
            expect(result).toContain("1. Fix the bug");
            expect(result).toContain("2. Run tests");
        });

        it("omits task line when sessionTitle is null", () => {
            const result = buildUserMessage(
                ["Option A"],
                "some context",
                null,
            );
            expect(result).not.toContain("Task:");
            expect(result).toContain("1. Option A");
        });

        it("truncates long session titles to 100 chars", () => {
            const longTitle = "A".repeat(200);
            const result = buildUserMessage(["opt"], "ctx", longTitle);
            const taskLine = result.split("\n").find((l) => l.startsWith("Task:"));
            expect(taskLine).toBeDefined();
            expect(taskLine!.length).toBeLessThanOrEqual(106);
        });

        it("numbers options sequentially", () => {
            const result = buildUserMessage(
                ["alpha", "beta", "gamma"],
                "ctx",
                null,
            );
            expect(result).toContain("1. alpha");
            expect(result).toContain("2. beta");
            expect(result).toContain("3. gamma");
        });
    });
});
