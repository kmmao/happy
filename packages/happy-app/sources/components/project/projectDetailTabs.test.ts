import { describe, expect, it } from "vitest";
import { resolveProjectDetailInitialTab, resolveProjectDetailTabs } from "./projectDetailTabs";

describe("resolveProjectDetailInitialTab", () => {
    it("keeps requested tab when enabled", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            knowledgeBaseEnabled: true,
        })).toBe("knowledge");
    });

    it("falls back to first tab when requested tab is unavailable", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            knowledgeBaseEnabled: false,
        })).toBe("sessions");
    });

    it("falls back to first tab for unknown tabs", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "totally-unknown",
            knowledgeBaseEnabled: true,
        })).toBe("sessions");
    });
});

describe("resolveProjectDetailTabs", () => {
    it("returns project operation tabs by default", () => {
        const tabs = resolveProjectDetailTabs({ knowledgeBaseEnabled: false });
        expect(tabs).toEqual(["sessions", "health", "research"]);
    });

    it("includes knowledge when enabled", () => {
        const tabs = resolveProjectDetailTabs({ knowledgeBaseEnabled: true });
        expect(tabs).toEqual(["sessions", "health", "research", "knowledge"]);
    });
});
