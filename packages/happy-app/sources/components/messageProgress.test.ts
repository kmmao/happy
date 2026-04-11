import { describe, expect, it } from "vitest";
import { getThinkingLabelTitle, parseTaskStatusMessage } from "./messageProgress";

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

describe("getThinkingLabelTitle", () => {
    it("extracts the first non-empty thinking line as the collapsed title", () => {
        expect(
            getThinkingLabelTitle("*Considering monitor and account recoveries\n\nMore details here*")
        ).toBe("Considering monitor and account recoveries");
    });

    it("strips markdown heading markers before returning the title", () => {
        expect(getThinkingLabelTitle("*## Investigate session state sync\nMore details*")).toBe(
            "Investigate session state sync",
        );
    });

    it("returns null when there is no meaningful thinking content", () => {
        expect(getThinkingLabelTitle("***")).toBeNull();
    });
});
