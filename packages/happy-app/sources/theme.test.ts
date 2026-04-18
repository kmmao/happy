import { describe, expect, it } from "vitest";

import {
    codexDarkColors,
    codexLightColors,
    sharedCodexTokens,
} from "./themeCodex";

describe("theme codex tokens", () => {
    it("exposes namespaced Code X color tokens on both themes", () => {
        expect(codexLightColors).toMatchObject({
            accent: "#3B5BDB",
            panelBg: "#F5F7FB",
            summaryBg: "#F7F9FF",
            status: {
                inProgress: "#2563EB",
                completed: "#16A34A",
            },
            diff: {
                addedBg: "#E8FAEF",
                removedBg: "#FDECEC",
            },
        });

        expect(codexDarkColors).toMatchObject({
            accent: "#7C9BFF",
            panelBg: "#0F1218",
            summaryBg: "#141C2E",
            status: {
                inProgress: "#7DA8FF",
                completed: "#4ADE80",
            },
            diff: {
                addedBg: "#10261A",
                removedBg: "#2A1618",
            },
        });
    });

    it("exposes Code X layout tokens outside colors for component styling", () => {
        expect(sharedCodexTokens).toEqual({
            radius: {
                panel: 14,
                section: 12,
                card: 12,
                chip: 999,
                diff: 10,
            },
            spacing: {
                sectionGap: 12,
                cardGap: 10,
                cardPadding: 12,
                panelPadding: 12,
                chipX: 8,
                chipY: 4,
                diffPadding: 10,
            },
            borderWidth: {
                soft: 1,
                strong: 1.5,
                focus: 2,
            },
        });
    });
});
