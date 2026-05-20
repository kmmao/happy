import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
    Platform: {
        OS: "ios",
        select: (options: Record<string, any>) => options.ios ?? options.default,
    },
    StyleSheet: {
        create: (styles: any) => styles,
        hairlineWidth: 1,
    },
}));

import {
    getFavoriteSlashChipGlassStyle,
    getFloatingGlassChipStyle,
} from "./agentInputGlassStyles";

describe("AgentInputStyles glass helpers", () => {
    it("returns favorite command chip glass styles with rounded blur container", () => {
        expect(getFavoriteSlashChipGlassStyle()).toEqual({
            container: {
                borderRadius: 18,
                borderWidth: 1,
                overflow: "hidden",
            },
            blur: {
                borderRadius: 18,
                overflow: "hidden",
            },
            content: {
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
            },
        });
    });

    it("returns floating chip glass styles for AI suggestion style buttons", () => {
        expect(getFloatingGlassChipStyle()).toEqual({
            container: {
                marginHorizontal: 8,
                marginTop: 8,
                marginBottom: 4,
                borderRadius: 14,
                borderWidth: 1,
                overflow: "hidden",
            },
            blur: {
                borderRadius: 14,
                overflow: "hidden",
            },
            content: {
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
            },
        });
    });
});
