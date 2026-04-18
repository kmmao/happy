import { describe, expect, it } from "vitest";

import {
  buildToolCardTheme,
  buildToolFullViewTheme,
  buildToolHeaderTheme,
  buildToolSimpleContentTheme,
} from "@/components/tools/toolChromeTheme";
import { codexLightColors } from "@/themeCodex";

const themeInput = {
  colors: {
    surface: "#ffffff",
    surfaceHigh: "#F8F8F8",
    surfaceHighest: "#f0f0f0",
    text: "#000000",
    textSecondary: "#49454F",
    textLink: "#2BACCC",
    warning: "#8E8E93",
    success: "#34C759",
    textDestructive: "#FF3B30",
    divider: "#eaeaea",
    header: {
      background: "#ffffff",
      tint: "#18171C",
    },
    box: {
      error: {
        background: "#FFF0F0",
        border: "#FF3B30",
        text: "#FF3B30",
      },
    },
    codex: codexLightColors,
  },
  codex: {
    radius: {
      card: 12,
    },
    spacing: {
      cardPadding: 12,
    },
    borderWidth: {
      soft: 1,
    },
  },
};

describe("tool chrome themes", () => {
  it("builds legacy tool card theme for default provider", () => {
    expect(buildToolCardTheme("default", themeInput)).toMatchObject({
      containerBackground: "#F8F8F8",
      headerBackground: "#f0f0f0",
      titleColor: "#000000",
      iconColor: "#000000",
      borderColor: null,
      borderWidth: 0,
      borderRadius: 8,
    });
  });

  it("builds Code X tool card theme for codex provider", () => {
    expect(buildToolCardTheme("codex", themeInput)).toMatchObject({
      containerBackground: codexLightColors.cardBg,
      headerBackground: codexLightColors.sectionBgElevated,
      titleColor: codexLightColors.textPrimary,
      iconColor: codexLightColors.accent,
      borderColor: codexLightColors.codeBorder,
      borderWidth: 1,
      borderRadius: 12,
    });
  });

  it("builds Code X header and full-view themes from codex tokens", () => {
    expect(buildToolHeaderTheme("codex", themeInput)).toMatchObject({
      navigationBackground: codexLightColors.sectionBg,
      navigationTint: codexLightColors.textPrimary,
      iconColor: codexLightColors.accent,
      titleColor: codexLightColors.textPrimary,
    });

    expect(buildToolFullViewTheme("codex", themeInput)).toMatchObject({
      background: codexLightColors.panelBg,
      modeTrackBackground: codexLightColors.sectionBgElevated,
      modeActiveBackground: codexLightColors.sectionBg,
      modeActiveText: codexLightColors.accent,
      copyButtonBackground: codexLightColors.chipBg,
      infoIconColor: codexLightColors.accent,
      errorIconColor: codexLightColors.status.blocked,
      copiedColor: codexLightColors.status.completed,
    });
  });

  it("builds provider-aware simple content themes", () => {
    expect(buildToolSimpleContentTheme("default", themeInput)).toMatchObject({
      titleCardBackground: "#f0f0f0",
      infoCardBackground: "#F8F8F8",
      titleColor: "#000000",
      labelColor: "#49454F",
      valueColor: "#000000",
      statusCompletedColor: "#34C759",
      statusErrorColor: "#FF3B30",
      statusRunningColor: "#8E8E93",
      borderColor: null,
      borderWidth: 0,
      borderRadius: 12,
    });

    expect(buildToolSimpleContentTheme("codex", themeInput)).toMatchObject({
      titleCardBackground: codexLightColors.sectionBgElevated,
      infoCardBackground: codexLightColors.cardBg,
      titleColor: codexLightColors.textPrimary,
      labelColor: codexLightColors.textSecondary,
      valueColor: codexLightColors.textPrimary,
      statusCompletedColor: codexLightColors.status.completed,
      statusErrorColor: codexLightColors.status.blocked,
      statusRunningColor: codexLightColors.accent,
      borderColor: codexLightColors.codeBorder,
      borderWidth: 1,
      borderRadius: 12,
    });
  });
});
