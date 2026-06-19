/**
 * Truncate a display string to a max length, reporting whether it was cut.
 *
 * The single home for the "cap long tool input/output for display" rule shared
 * by both message formatters (terminal + Ink). It returns only the cut text and
 * a `truncated` flag — the "... (truncated)" suffix and its styling stay with
 * each formatter, because they differ per sink (the terminal formatter prefixes
 * a gray newline, the Ink formatter appends plain text).
 */
export function truncateForDisplay(
  value: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (value.length > maxLength) {
    return { text: value.substring(0, maxLength), truncated: true };
  }
  return { text: value, truncated: false };
}
