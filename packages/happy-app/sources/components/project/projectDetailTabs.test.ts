import { describe, expect, it } from "vitest";
import { resolveProjectDetailInitialTab } from "./projectDetailTabs";

describe("resolveProjectDetailInitialTab", () => {
    it("keeps requested tab when enabled", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            knowledgeBaseEnabled: true,
        })).toBe("knowledge");
    });

    it("falls back to world when requested tab is unavailable", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "knowledge",
            knowledgeBaseEnabled: false,
        })).toBe("world");
    });

    it("falls back to world for unknown tabs", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "totally-unknown",
            knowledgeBaseEnabled: true,
        })).toBe("world");
    });
});
