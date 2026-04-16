import { describe, expect, it } from "vitest";

import {
    getSessionPanelTabDefinitions,
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
} from "./sessionPanelTabs";

describe("sessionPanelTabs", () => {
    it("returns changes first and files second", () => {
        const tabs = getSessionPanelTabs(true);

        expect(tabs[0]).toBe("changes");
        expect(tabs[1]).toBe("files");
    });

    it("includes preview only when enabled", () => {
        expect(getSessionPanelTabs(true)).toContain("preview");
        expect(getSessionPanelTabs(false)).not.toContain("preview");
    });

    it("returns shared label keys for each tab", () => {
        expect(getSessionPanelTabDefinitions(true)).toEqual([
            { key: "changes", labelKey: "sidePanel.changes" },
            { key: "files", labelKey: "sidePanel.files" },
            { key: "code", labelKey: "sidePanel.code" },
            { key: "preview", labelKey: "sidePanel.preview" },
            { key: "summary", labelKey: "sidePanel.summary" },
            { key: "terminal", labelKey: "sidePanel.terminal" },
        ]);
    });

    it("falls back to the first available tab when current tab is unavailable", () => {
        expect(
            resolveSessionPanelActiveTab("preview", getSessionPanelTabs(false)),
        ).toBe("changes");
    });

    it("keeps current tab when still available", () => {
        expect(
            resolveSessionPanelActiveTab("summary", getSessionPanelTabs(true)),
        ).toBe("summary");
    });
});
