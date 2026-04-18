import { type ToolProvider } from "@/components/tools/toolProvider";

export interface ToolChromeThemeInput {
  colors: {
    surface: string;
    surfaceHigh: string;
    surfaceHighest: string;
    text: string;
    textSecondary: string;
    textLink: string;
    warning: string;
    success: string;
    textDestructive: string;
    divider: string;
    header: {
      background: string;
      tint: string;
    };
    box: {
      error: {
        background: string;
        border: string;
        text: string;
      };
    };
    codex: {
      panelBg: string;
      sectionBg: string;
      sectionBgElevated: string;
      cardBg: string;
      codeBorder: string;
      textPrimary: string;
      textSecondary: string;
      textMuted: string;
      accent: string;
      chipBg: string;
      chipBorder: string;
      chipText: string;
      status: {
        completed: string;
        blocked: string;
      };
    };
  };
  codex: {
    radius: {
      card: number;
    };
    borderWidth: {
      soft: number;
    };
  };
}

export interface ToolCardTheme {
  containerBackground: string;
  headerBackground: string;
  titleColor: string;
  subtitleColor: string;
  elapsedColor: string;
  iconColor: string;
  runningColor: string;
  errorColor: string;
  mutedStatusColor: string;
  borderColor: string | null;
  borderWidth: number;
  borderRadius: number;
}

export interface ToolHeaderTheme {
  navigationBackground: string;
  navigationTint: string;
  iconColor: string;
  titleColor: string;
  subtitleColor: string;
  runningColor: string;
  completedColor: string;
  errorColor: string;
}

export interface ToolFullViewTheme {
  background: string;
  modeTrackBackground: string;
  modeActiveBackground: string;
  modeActiveText: string;
  modeInactiveText: string;
  sectionTitleColor: string;
  descriptionColor: string;
  copyButtonBackground: string;
  copyButtonBorder: string;
  copyButtonText: string;
  copiedColor: string;
  infoIconColor: string;
  inputIconColor: string;
  outputIconColor: string;
  errorIconColor: string;
  rawIconColor: string;
  emptyIconColor: string;
  errorBackground: string;
  errorBorder: string;
  errorText: string;
}

export interface ToolSimpleContentTheme {
  titleCardBackground: string;
  infoCardBackground: string;
  titleColor: string;
  labelColor: string;
  valueColor: string;
  borderColor: string | null;
  borderWidth: number;
  borderRadius: number;
  statusCompletedColor: string;
  statusErrorColor: string;
  statusRunningColor: string;
}

export function buildToolCardTheme(
  provider: ToolProvider,
  theme: ToolChromeThemeInput,
): ToolCardTheme {
  if (provider === "codex") {
    return {
      containerBackground: theme.colors.codex.cardBg,
      headerBackground: theme.colors.codex.sectionBgElevated,
      titleColor: theme.colors.codex.textPrimary,
      subtitleColor: theme.colors.codex.textSecondary,
      elapsedColor: theme.colors.codex.textSecondary,
      iconColor: theme.colors.codex.accent,
      runningColor: theme.colors.codex.accent,
      errorColor: theme.colors.codex.status.blocked,
      mutedStatusColor: theme.colors.codex.textSecondary,
      borderColor: theme.colors.codex.codeBorder,
      borderWidth: theme.codex.borderWidth.soft,
      borderRadius: theme.codex.radius.card,
    };
  }

  return {
    containerBackground: theme.colors.surfaceHigh,
    headerBackground: theme.colors.surfaceHighest,
    titleColor: theme.colors.text,
    subtitleColor: theme.colors.textSecondary,
    elapsedColor: theme.colors.textSecondary,
    iconColor: theme.colors.text,
    runningColor: theme.colors.text,
    errorColor: theme.colors.warning,
    mutedStatusColor: theme.colors.textSecondary,
    borderColor: null,
    borderWidth: 0,
    borderRadius: 8,
  };
}

export function buildToolHeaderTheme(
  provider: ToolProvider,
  theme: ToolChromeThemeInput,
): ToolHeaderTheme {
  if (provider === "codex") {
    return {
      navigationBackground: theme.colors.codex.sectionBg,
      navigationTint: theme.colors.codex.textPrimary,
      iconColor: theme.colors.codex.accent,
      titleColor: theme.colors.codex.textPrimary,
      subtitleColor: theme.colors.codex.textSecondary,
      runningColor: theme.colors.codex.accent,
      completedColor: theme.colors.codex.status.completed,
      errorColor: theme.colors.codex.status.blocked,
    };
  }

  return {
    navigationBackground: theme.colors.header.background,
    navigationTint: theme.colors.header.tint,
    iconColor: theme.colors.header.tint,
    titleColor: theme.colors.text,
    subtitleColor: theme.colors.textSecondary,
    runningColor: theme.colors.textLink,
    completedColor: theme.colors.success,
    errorColor: theme.colors.textDestructive,
  };
}

export function buildToolFullViewTheme(
  provider: ToolProvider,
  theme: ToolChromeThemeInput,
): ToolFullViewTheme {
  if (provider === "codex") {
    return {
      background: theme.colors.codex.panelBg,
      modeTrackBackground: theme.colors.codex.sectionBgElevated,
      modeActiveBackground: theme.colors.codex.sectionBg,
      modeActiveText: theme.colors.codex.accent,
      modeInactiveText: theme.colors.codex.textSecondary,
      sectionTitleColor: theme.colors.codex.textPrimary,
      descriptionColor: theme.colors.codex.textSecondary,
      copyButtonBackground: theme.colors.codex.chipBg,
      copyButtonBorder: theme.colors.codex.chipBorder,
      copyButtonText: theme.colors.codex.chipText,
      copiedColor: theme.colors.codex.status.completed,
      infoIconColor: theme.colors.codex.accent,
      inputIconColor: theme.colors.codex.accent,
      outputIconColor: theme.colors.codex.status.completed,
      errorIconColor: theme.colors.codex.status.blocked,
      rawIconColor: theme.colors.codex.accent,
      emptyIconColor: theme.colors.codex.status.completed,
      errorBackground: theme.colors.codex.sectionBgElevated,
      errorBorder: theme.colors.codex.status.blocked,
      errorText: theme.colors.codex.textPrimary,
    };
  }

  return {
    background: theme.colors.surface,
    modeTrackBackground: theme.colors.surfaceHighest,
    modeActiveBackground: theme.colors.surface,
    modeActiveText: theme.colors.textLink,
    modeInactiveText: theme.colors.textSecondary,
    sectionTitleColor: theme.colors.text,
    descriptionColor: theme.colors.textSecondary,
    copyButtonBackground: theme.colors.surfaceHigh,
    copyButtonBorder: theme.colors.divider,
    copyButtonText: theme.colors.textSecondary,
    copiedColor: theme.colors.success,
    infoIconColor: "#5856D6",
    inputIconColor: "#5856D6",
    outputIconColor: "#34C759",
    errorIconColor: "#FF3B30",
    rawIconColor: "#FF9500",
    emptyIconColor: "#34C759",
    errorBackground: theme.colors.box.error.background,
    errorBorder: theme.colors.box.error.border,
    errorText: theme.colors.box.error.text,
  };
}

export function buildToolSimpleContentTheme(
  provider: ToolProvider,
  theme: ToolChromeThemeInput,
): ToolSimpleContentTheme {
  if (provider === "codex") {
    return {
      titleCardBackground: theme.colors.codex.sectionBgElevated,
      infoCardBackground: theme.colors.codex.cardBg,
      titleColor: theme.colors.codex.textPrimary,
      labelColor: theme.colors.codex.textSecondary,
      valueColor: theme.colors.codex.textPrimary,
      borderColor: theme.colors.codex.codeBorder,
      borderWidth: theme.codex.borderWidth.soft,
      borderRadius: theme.codex.radius.card,
      statusCompletedColor: theme.colors.codex.status.completed,
      statusErrorColor: theme.colors.codex.status.blocked,
      statusRunningColor: theme.colors.codex.accent,
    };
  }

  return {
    titleCardBackground: theme.colors.surfaceHighest,
    infoCardBackground: theme.colors.surfaceHigh,
    titleColor: theme.colors.text,
    labelColor: theme.colors.textSecondary,
    valueColor: theme.colors.text,
    borderColor: null,
    borderWidth: 0,
    borderRadius: 12,
    statusCompletedColor: theme.colors.success,
    statusErrorColor: theme.colors.textDestructive,
    statusRunningColor: theme.colors.warning,
  };
}
