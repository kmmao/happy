import { describe, expect, it, vi } from "vitest";

vi.mock("@/ui/logger", () => ({
    logger: {
        debug: vi.fn(),
    },
}));

import { DiffProcessor } from "../utils/diffProcessor";

describe("DiffProcessor", () => {
    it("emits CodexDiff tool lifecycle when turn diff changes", () => {
        const messages: any[] = [];
        const processor = new DiffProcessor((message) => {
            messages.push(message);
        });

        processor.processDiff(
            [
                "diff --git a/src/one.ts b/src/one.ts",
                "--- a/src/one.ts",
                "+++ b/src/one.ts",
                "@@ -1 +1 @@",
                "-old",
                "+new",
            ].join("\n"),
        );

        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
            type: "tool-call",
            name: "CodexDiff",
            input: {
                unified_diff: [
                    "diff --git a/src/one.ts b/src/one.ts",
                    "--- a/src/one.ts",
                    "+++ b/src/one.ts",
                    "@@ -1 +1 @@",
                    "-old",
                    "+new",
                ].join("\n"),
            },
        });
        expect(messages[1]).toMatchObject({
            type: "tool-call-result",
            output: {
                status: "completed",
            },
        });
    });

    it("does not emit duplicate CodexDiff events when the diff is unchanged", () => {
        const messages: any[] = [];
        const processor = new DiffProcessor((message) => {
            messages.push(message);
        });
        const diff = "@@ -1 +1 @@\n-old\n+new";

        processor.processDiff(diff);
        processor.processDiff(diff);

        expect(messages).toHaveLength(2);
    });

    it("resets dedupe state after reset()", () => {
        const messages: any[] = [];
        const processor = new DiffProcessor((message) => {
            messages.push(message);
        });
        const diff = "@@ -1 +1 @@\n-old\n+new";

        processor.processDiff(diff);
        processor.reset();
        processor.processDiff(diff);

        expect(messages).toHaveLength(4);
    });
});
