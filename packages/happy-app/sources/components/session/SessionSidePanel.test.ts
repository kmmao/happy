import { describe, expect, it } from "vitest";

import { getSessionPanelTabs } from "./sessionPanelTabs";

describe("getSessionPanelTabs", () => {
    it("places session first", () => {
        const tabs = getSessionPanelTabs({ enablePreviewTab: true });

        expect(tabs[0]).toBe("session");
    });

    it("hides preview tab when experiment is disabled", () => {
        const tabs = getSessionPanelTabs({ enablePreviewTab: false });

        expect(tabs.includes("preview")).toBe(false);
    });

    it("shows preview tab when experiment is enabled", () => {
        const tabs = getSessionPanelTabs({ enablePreviewTab: true });

        expect(tabs.includes("preview")).toBe(true);
    });
});
