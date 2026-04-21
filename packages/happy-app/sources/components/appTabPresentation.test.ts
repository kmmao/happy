import { describe, expect, it } from "vitest";
import { resolveAppTabPresentation } from "./appTabPresentation";

describe("resolveAppTabPresentation", () => {
    it("keeps sessions as the neutral structural tab", () => {
        expect(resolveAppTabPresentation("sessions")).toMatchObject({
            icon: "chatbubble-ellipses-outline",
            tone: "neutral",
        });
    });

    it("assigns distinct tones to inbox, project, openclaw, and settings", () => {
        expect(resolveAppTabPresentation("inbox")).toMatchObject({
            icon: "mail-outline",
            tone: "blue",
        });
        expect(resolveAppTabPresentation("project")).toMatchObject({
            icon: "folder-open-outline",
            tone: "purple",
        });
        expect(resolveAppTabPresentation("openclaw")).toMatchObject({
            icon: "sparkles-outline",
            tone: "orange",
        });
        expect(resolveAppTabPresentation("settings")).toMatchObject({
            icon: "settings-outline",
            tone: "teal",
        });
    });
});
