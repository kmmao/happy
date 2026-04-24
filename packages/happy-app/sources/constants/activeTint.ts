import type { Theme } from "@/theme";

/**
 * Background color for active/selected controls (tabs, segmented controls,
 * chips, primary buttons). In dark mode `header.tint` is `#ffffff`, which
 * would collide with white foreground text/icons — fall back to accentPurple.
 */
export function resolveActiveTint(theme: Theme): string {
    return theme.dark ? theme.colors.accentPurple : theme.colors.header.tint;
}
