import { describe, expect, it } from "vitest";
import { parseTaskStatusMessage } from "./messageProgress";

describe("parseTaskStatusMessage", () => {
    it("parses labeled task-progress text into summary and metrics", () => {
        expect(
            parseTaskStatusMessage(
                "⏳ Task progress\nReading getExpandedSidebarWidth tests\n_46s · 0 tokens · 11 tools_",
            ),
        ).toEqual({
            status: "progress",
            summary: "Reading getExpandedSidebarWidth tests",
            metrics: "46s · 0 tokens · 11 tools",
        });
    });

    it("parses task-start text into start status", () => {
        expect(
            parseTaskStatusMessage("⏳ Task started\nRun sidebar tests"),
        ).toEqual({
            status: "start",
            summary: "Run sidebar tests",
            metrics: null,
        });
    });

    it("parses task-end text into terminal status", () => {
        expect(
            parseTaskStatusMessage("✓ Task completed\nSidebar tests passed"),
        ).toEqual({
            status: "completed",
            summary: "Sidebar tests passed",
            metrics: null,
        });
    });

    it("returns null for normal assistant messages", () => {
        expect(parseTaskStatusMessage("Here is the final answer")).toBeNull();
    });

    it("returns null when the task-progress label exists without a summary", () => {
        expect(parseTaskStatusMessage("⏳ Task progress\n\n_46s · 0 tokens_"))
            .toBeNull();
    });
});
