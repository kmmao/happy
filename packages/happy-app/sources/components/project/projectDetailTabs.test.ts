import { describe, expect, it } from "vitest";
import { resolveProjectDetailInitialTab, resolveProjectDetailTabs } from "./projectDetailTabs";

describe("resolveProjectDetailInitialTab", () => {
    it("keeps requested tab when enabled", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            worldModelEnabled: true,
            knowledgeBaseEnabled: true,
        })).toBe("knowledge");
    });

    it("falls back to first tab when requested tab is unavailable", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            worldModelEnabled: true,
            knowledgeBaseEnabled: false,
        })).toBe("world");
    });

    it("falls back to sessions when world model disabled and no valid tab", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "world",
            worldModelEnabled: false,
            knowledgeBaseEnabled: false,
        })).toBe("sessions");
    });

    it("falls back to first tab for unknown tabs", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "totally-unknown",
            worldModelEnabled: true,
            knowledgeBaseEnabled: true,
        })).toBe("world");
    });
});

describe("resolveProjectDetailTabs", () => {
    it("includes world model tabs when enabled", () => {
        const tabs = resolveProjectDetailTabs({ worldModelEnabled: true, knowledgeBaseEnabled: false });
        expect(tabs).toContain("world");
        expect(tabs).toContain("team");
        expect(tabs).toContain("goals");
    });

    it("excludes world model tabs when disabled but keeps health", () => {
        const tabs = resolveProjectDetailTabs({ worldModelEnabled: false, knowledgeBaseEnabled: false });
        expect(tabs).not.toContain("world");
        expect(tabs).not.toContain("team");
        expect(tabs).not.toContain("goals");
        expect(tabs).toContain("sessions");
        expect(tabs).toContain("health");
        expect(tabs).toContain("research");
    });

    it("includes knowledge when enabled", () => {
        const tabs = resolveProjectDetailTabs({ worldModelEnabled: false, knowledgeBaseEnabled: true });
        expect(tabs).toContain("knowledge");
    });
});
