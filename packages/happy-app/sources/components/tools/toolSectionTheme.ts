export type ToolSectionProvider = "default" | "codex";

export interface ToolSectionThemeInput {
  colors: {
    textSecondary: string;
    codex: {
      textSecondary: string;
    };
  };
  codex: {
    spacing: {
      sectionGap: number;
      panelPadding: number;
    };
  };
}

export interface ToolSectionTheme {
  sectionMarginBottom: number;
  fullWidthOffset: number;
  titleColor: string;
  titleMarginBottom: number;
  titleTransform: "uppercase" | "none";
  titleLetterSpacing: number;
}

export function buildToolSectionTheme(
  provider: ToolSectionProvider,
  theme: ToolSectionThemeInput,
): ToolSectionTheme {
  if (provider === "codex") {
    return {
      sectionMarginBottom: theme.codex.spacing.sectionGap,
      fullWidthOffset: theme.codex.spacing.panelPadding,
      titleColor: theme.colors.codex.textSecondary,
      titleMarginBottom: theme.codex.spacing.sectionGap - 4,
      titleTransform: "none",
      titleLetterSpacing: 0.2,
    };
  }

  return {
    sectionMarginBottom: 12,
    fullWidthOffset: 12,
    titleColor: theme.colors.textSecondary,
    titleMarginBottom: 6,
    titleTransform: "uppercase",
    titleLetterSpacing: 0,
  };
}
