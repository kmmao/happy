import { describe, expect, it } from "vitest";
import { shouldLogChatListTiming } from "./chatListPerformanceTiming";

describe("shouldLogChatListTiming", () => {
    it("skips fast computations", () => {
        expect(
            shouldLogChatListTiming({
                durationMs: 4,
                thresholdMs: 8,
                nowMs: 1000,
                lastLoggedAtMs: null,
                cooldownMs: 5000,
            }),
        ).toBe(false);
    });

    it("logs slow computations when there is no previous log", () => {
        expect(
            shouldLogChatListTiming({
                durationMs: 8,
                thresholdMs: 8,
                nowMs: 1000,
                lastLoggedAtMs: null,
                cooldownMs: 5000,
            }),
        ).toBe(true);
    });

    it("skips slow computations during cooldown", () => {
        expect(
            shouldLogChatListTiming({
                durationMs: 12,
                thresholdMs: 8,
                nowMs: 3000,
                lastLoggedAtMs: 1000,
                cooldownMs: 5000,
            }),
        ).toBe(false);
    });

    it("logs slow computations after cooldown", () => {
        expect(
            shouldLogChatListTiming({
                durationMs: 12,
                thresholdMs: 8,
                nowMs: 7000,
                lastLoggedAtMs: 1000,
                cooldownMs: 5000,
            }),
        ).toBe(true);
    });
});
