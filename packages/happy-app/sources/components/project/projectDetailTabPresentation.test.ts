import { describe, expect, it } from "vitest";
import {
    resolveProjectDetailTabPresentation,
} from "./projectDetailTabPresentation";
import { UiTabTone } from "@/components/tabTone";

function expectPresentation(
    key: Parameters<typeof resolveProjectDetailTabPresentation>[0],
    expected: {
        icon: string;
        tone: UiTabTone;
    },
) {
    expect(resolveProjectDetailTabPresentation(key)).toMatchObject(expected);
}

describe("resolveProjectDetailTabPresentation", () => {
    it("keeps sessions neutral because it is the structural default tab", () => {
        expectPresentation("sessions", {
            icon: "chatbubble-ellipses-outline",
            tone: "neutral",
        });
    });

    it("assigns distinct semantics to health and research", () => {
        expectPresentation("health", {
            icon: "pulse-outline",
            tone: "green",
        });
        expectPresentation("research", {
            icon: "search-outline",
            tone: "blue",
        });
    });
});
