import { type CodexColorTokens } from "@/themeCodex";

export interface CodexToolViewTheme {
  cardBg: string;
  cardBgHover: string;
  cardBorder: string;
  divider: string;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  title: string;
  subtitle: string;
  meta: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
}

export function buildCodexToolViewTheme(
  colors: CodexColorTokens,
): CodexToolViewTheme {
  return {
    cardBg: colors.cardBg,
    cardBgHover: colors.cardBgHover,
    cardBorder: colors.codeBorder,
    divider: colors.borderSoft,
    iconBg: colors.chipBg,
    iconBorder: colors.chipBorder,
    iconColor: colors.accent,
    title: colors.textPrimary,
    subtitle: colors.textSecondary,
    meta: colors.textMuted,
    chipBg: colors.chipBg,
    chipBorder: colors.chipBorder,
    chipText: colors.chipText,
  };
}
