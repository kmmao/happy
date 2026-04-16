import { describe, expect, it } from "vitest";

import {
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
