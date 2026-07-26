import { describe, expect, it } from "vitest";
import { resolveProjectDetailInitialTab, resolveProjectDetailTabs } from "./projectDetailTabs";

const ALL_TABS = [
    "sessions",
    "workflows",
    "git",
    "supervisor",
    "health",
    "events",
    "research",
    "traces",
    "config",
];

describe("resolveProjectDetailInitialTab", () => {
    it("keeps requested tab when it is a known tab", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "research",
        })).toBe("research");
    });

    it("falls back to first tab for unknown tabs", () => {
        expect(resolveProjectDetailInitialTab({
            requestedTab: "totally-unknown",
        })).toBe("sessions");
    });

    it("falls back to first tab when no tab is requested", () => {
        expect(resolveProjectDetailInitialTab({})).toBe("sessions");
    });
});

describe("resolveProjectDetailTabs", () => {
    it("returns project operation tabs", () => {
        expect(resolveProjectDetailTabs()).toEqual(ALL_TABS);
    });
});
