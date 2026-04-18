import { describe, expect, it } from "vitest";

import {
  buildToolSectionTheme,
  type ToolSectionThemeInput,
} from "@/components/tools/toolSectionTheme";

const themeInput: ToolSectionThemeInput = {
  colors: {
    textSecondary: "#49454F",
    codex: {
      textSecondary: "#4B5563",
    },
  },
  codex: {
    spacing: {
      sectionGap: 12,
      panelPadding: 12,
    },
  },
};

describe("buildToolSectionTheme", () => {
  it("keeps legacy title chrome for default provider", () => {
    expect(buildToolSectionTheme("default", themeInput)).toEqual({
      sectionMarginBottom: 12,
      fullWidthOffset: 12,
      titleColor: "#49454F",
      titleMarginBottom: 6,
      titleTransform: "uppercase",
      titleLetterSpacing: 0,
    });
  });

  it("returns Code X title chrome for codex provider", () => {
    expect(buildToolSectionTheme("codex", themeInput)).toEqual({
      sectionMarginBottom: 12,
      fullWidthOffset: 12,
      titleColor: "#4B5563",
      titleMarginBottom: 8,
      titleTransform: "none",
      titleLetterSpacing: 0.2,
    });
  });
});
