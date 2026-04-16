import { describe, expect, it } from "vitest";

import { getSessionPanelTabs } from "./sessionPanelTabs";

describe("getSessionPanelTabs", () => {
    it("places changes first and files second", () => {
        const tabs = getSessionPanelTabs(true);

        expect(tabs[0]).toBe("changes");
        expect(tabs[1]).toBe("files");
    });

    it("hides preview tab when experiment is disabled", () => {
        const tabs = getSessionPanelTabs(false);

        expect(tabs.includes("preview")).toBe(false);
    });

    it("shows preview tab when experiment is enabled", () => {
        const tabs = getSessionPanelTabs(true);

        expect(tabs.includes("preview")).toBe(true);
    });
});
