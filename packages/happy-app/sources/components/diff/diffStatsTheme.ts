export type DiffStatsProvider = "default" | "codex";

export interface DiffStatsThemeInput {
  colors: {
    diff: {
      success: string;
      error: string;
    };
    codex: {
      changeKind: {
        add: string;
        delete: string;
      };
      borderSoft: string;
    };
  };
  codex: {
    spacing: {
      cardGap: number;
    };
    radius: {
      chip: number;
    };
  };
}

export interface DiffStatsTheme {
  additionsColor: string;
  deletionsColor: string;
  trackColor: string | null;
  marginLeft: number;
  radius: number;
}

export function buildDiffStatsTheme(
  provider: DiffStatsProvider,
  theme: DiffStatsThemeInput,
): DiffStatsTheme {
  if (provider === "codex") {
    return {
      additionsColor: theme.colors.codex.changeKind.add,
      deletionsColor: theme.colors.codex.changeKind.delete,
      trackColor: theme.colors.codex.borderSoft,
      marginLeft: theme.codex.spacing.cardGap - 2,
      radius: theme.codex.radius.chip,
    };
  }

  return {
    additionsColor: theme.colors.diff.success,
    deletionsColor: theme.colors.diff.error,
    trackColor: null,
    marginLeft: 8,
    radius: 3,
  };
}
