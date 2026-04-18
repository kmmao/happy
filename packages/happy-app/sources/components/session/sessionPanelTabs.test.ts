import { describe, expect, it } from "vitest";

import {
    getSessionPanelTabDefinitions,
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
} from "./sessionPanelTabs";

describe("sessionPanelTabs", () => {
    it("returns session first", () => {
        const tabs = getSessionPanelTabs({
            enablePreviewTab: true,
            knowledgeBaseEnabled: true,
        });

        expect(tabs[0]).toBe("session");
    });

    it("includes preview only when enabled", () => {
        expect(
            getSessionPanelTabs({ enablePreviewTab: true, knowledgeBaseEnabled: true }),
        ).toContain("preview");
        expect(
            getSessionPanelTabs({ enablePreviewTab: false, knowledgeBaseEnabled: true }),
        ).not.toContain("preview");
    });

    it("includes knowledge only when the project knowledge base is enabled", () => {
        expect(
            getSessionPanelTabs({ enablePreviewTab: true, knowledgeBaseEnabled: true }),
        ).toContain("knowledge");
        expect(
            getSessionPanelTabs({ enablePreviewTab: true, knowledgeBaseEnabled: false }),
        ).not.toContain("knowledge");
    });

    it("no longer exposes 'code' as a top-level tab", () => {
        expect(
            getSessionPanelTabs({ enablePreviewTab: true, knowledgeBaseEnabled: true }),
        ).not.toContain("code" as never);
    });

    it("returns shared label keys for each tab", () => {
        expect(
            getSessionPanelTabDefinitions({
                enablePreviewTab: true,
                knowledgeBaseEnabled: true,
            }),
        ).toEqual([
            { key: "session", labelKey: "sidePanel.session" },
            { key: "knowledge", labelKey: "sidePanel.knowledge" },
            { key: "changes", labelKey: "sidePanel.changes" },
            { key: "files", labelKey: "sidePanel.files" },
            { key: "preview", labelKey: "sidePanel.preview" },
            { key: "terminal", labelKey: "sidePanel.terminal" },
        ]);
    });

    it("falls back to the first available tab when current tab is unavailable", () => {
        expect(
            resolveSessionPanelActiveTab(
                "preview",
                getSessionPanelTabs({
                    enablePreviewTab: false,
                    knowledgeBaseEnabled: true,
                }),
            ),
        ).toBe("session");
    });

    it("keeps current tab when still available", () => {
        expect(
            resolveSessionPanelActiveTab(
                "knowledge",
                getSessionPanelTabs({
                    enablePreviewTab: true,
                    knowledgeBaseEnabled: true,
                }),
            ),
        ).toBe("knowledge");
    });

    it("falls back from knowledge to session when knowledge base is disabled", () => {
        expect(
            resolveSessionPanelActiveTab(
                "knowledge",
                getSessionPanelTabs({
                    enablePreviewTab: false,
                    knowledgeBaseEnabled: false,
                }),
            ),
        ).toBe("session");
    });
});
