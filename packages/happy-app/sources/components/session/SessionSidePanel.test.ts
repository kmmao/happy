import { describe, expect, it } from "vitest";

import { getSessionPanelTabs } from "./sessionPanelTabs";

describe("getSessionPanelTabs", () => {
    it("places session first and knowledge second", () => {
        const tabs = getSessionPanelTabs({
            enablePreviewTab: true,
            knowledgeBaseEnabled: true,
        });

        expect(tabs[0]).toBe("session");
        expect(tabs[1]).toBe("knowledge");
    });

    it("hides preview tab when experiment is disabled", () => {
        const tabs = getSessionPanelTabs({
            enablePreviewTab: false,
            knowledgeBaseEnabled: true,
        });

        expect(tabs.includes("preview")).toBe(false);
    });

    it("shows preview tab when experiment is enabled", () => {
        const tabs = getSessionPanelTabs({
            enablePreviewTab: true,
            knowledgeBaseEnabled: true,
        });

        expect(tabs.includes("preview")).toBe(true);
    });

    it("drops knowledge tab when the project knowledge base is disabled", () => {
        const tabs = getSessionPanelTabs({
            enablePreviewTab: true,
            knowledgeBaseEnabled: false,
        });

        expect(tabs.includes("knowledge")).toBe(false);
    });
});
