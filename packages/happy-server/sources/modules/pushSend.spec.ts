import { describe, expect, it } from "vitest";
import { buildBriefPushBody } from "./pushSend";

describe("buildBriefPushBody", () => {
    it("uses goal and current focus from brief detail", () => {
        const body = buildBriefPushBody({
            summary: "Loop completed — fallback summary",
            detail: [
                "Goal: Keep the project healthy and surface regressions before users hit them.",
                "Current focus: Verify session ready notifications now include useful structured context.",
            ].join("\n\n"),
        });

        expect(body).toBe("Goal: Keep the project healthy and surface regressions before users hit them. Current focus: Verify…");
        expect(body.length).toBeLessThanOrEqual(100);
    });

    it("falls back to normalized summary", () => {
        expect(buildBriefPushBody({ summary: "Loop completed\nwith details" })).toBe("Loop completed with details");
    });
});
