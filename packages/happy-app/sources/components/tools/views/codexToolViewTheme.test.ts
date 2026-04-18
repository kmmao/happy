import { describe, expect, it } from "vitest";

import { buildCodexToolViewTheme } from "@/components/tools/views/codexToolViewTheme";
import { codexDarkColors, codexLightColors } from "@/themeCodex";

describe("buildCodexToolViewTheme", () => {
  it("maps Code X light tokens into tool view chrome", () => {
    expect(buildCodexToolViewTheme(codexLightColors)).toEqual({
      cardBg: codexLightColors.cardBg,
      cardBgHover: codexLightColors.cardBgHover,
      cardBorder: codexLightColors.codeBorder,
      divider: codexLightColors.borderSoft,
      iconBg: codexLightColors.chipBg,
      iconBorder: codexLightColors.chipBorder,
      iconColor: codexLightColors.accent,
      title: codexLightColors.textPrimary,
      subtitle: codexLightColors.textSecondary,
      meta: codexLightColors.textMuted,
      chipBg: codexLightColors.chipBg,
      chipBorder: codexLightColors.chipBorder,
      chipText: codexLightColors.chipText,
    });
  });

  it("maps Code X dark tokens into tool view chrome", () => {
    expect(buildCodexToolViewTheme(codexDarkColors)).toEqual({
      cardBg: codexDarkColors.cardBg,
      cardBgHover: codexDarkColors.cardBgHover,
      cardBorder: codexDarkColors.codeBorder,
      divider: codexDarkColors.borderSoft,
      iconBg: codexDarkColors.chipBg,
      iconBorder: codexDarkColors.chipBorder,
      iconColor: codexDarkColors.accent,
      title: codexDarkColors.textPrimary,
      subtitle: codexDarkColors.textSecondary,
      meta: codexDarkColors.textMuted,
      chipBg: codexDarkColors.chipBg,
      chipBorder: codexDarkColors.chipBorder,
      chipText: codexDarkColors.chipText,
    });
  });
});
