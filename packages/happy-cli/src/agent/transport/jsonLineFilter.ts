/**
 * The single rule for "is this stdout line a valid JSON-RPC message we should
 * forward?" — shared by every transport's `filterStdoutLine`. A line qualifies
 * only if it is non-empty, starts with `{` or `[`, and parses to a JSON object
 * or array (never a primitive — bare numbers like `105887304` are valid JSON but
 * not JSON-RPC). Returns the ORIGINAL line (untrimmed) when it qualifies, or
 * `null` to drop it. Keeping this in one place means a tightening of the rule
 * lands once instead of drifting across the Default/Gemini/Codex transports.
 */
export function validateJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return line;
  } catch {
    return null;
  }
}
