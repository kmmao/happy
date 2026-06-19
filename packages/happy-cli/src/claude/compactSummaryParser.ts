/**
 * Pure JSONL → summary-text extractor for the `/compact` flow.
 *
 * Two record shapes carry the post-compact summary across SDK / PTY modes:
 *
 *  1. PTY/TUI (Claude Code 2.x): a `compact_boundary` system record is
 *     followed immediately by a user record with `isCompactSummary: true`
 *     whose `message.content` IS the full summary text (the same prose
 *     Claude paste-injects as the new conversation seed). `parentUuid` on
 *     that user record points back at the boundary's `uuid` — this is how
 *     we tie a specific summary to the specific /compact that produced it
 *     when one /compact follows another in the same session.
 *
 *  2. SDK era: a `type:"summary"` record carrying `summary` directly.
 *     Retained as a fallback for any historical / SDK-mode JSONLs.
 *
 * The parser is intentionally I/O-free so it can be exercised with synthetic
 * fixtures (see compactSummaryParser.test.ts). The file-reading wrapper
 * lives in claudeRemoteLauncherCore.ts (which adds the polling horizon).
 *
 * Selection rule when both shapes coexist in the same file:
 *   1. If `boundaryUuid` is supplied AND a PTY user record's parentUuid
 *      matches, return that (precise tie to a specific /compact run).
 *   2. Otherwise return the LATEST summary of either shape in file order
 *      (last-write-wins; matches the "show me the most recent summary"
 *      semantics of the getCompactionSummary RPC and the fork-copy path).
 *   3. If neither shape is present, return null.
 *
 * Trimming: the returned text is `.trim()`-ed because the TUI sometimes
 * trails a single newline on the user-record content. Empty / whitespace
 * summaries are coerced to null so the caller doesn't emit a blank bubble.
 */

type UserMessageContent =
  | string
  | Array<{ type?: string; text?: string }>;

/**
 * Flatten a Claude user-message `content` field (string or block array) to
 * a single string. Non-text blocks (images, tool_use, …) are skipped.
 */
function flattenUserContent(content: UserMessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

/**
 * Parse a JSONL string (one record per line) and extract the most relevant
 * post-`/compact` summary text. See file docblock for selection rules.
 *
 * Returns trimmed text, or null when no usable summary is present.
 */
export function extractCompactSummary(
  jsonlText: string,
  boundaryUuid?: string,
): string | null {
  let latestSummary: string | null = null;
  let matchedByBoundary: string | null = null;
  for (const line of jsonlText.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A truncated final line during an in-flight write is normal; skip.
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const rec = parsed as {
      type?: string;
      isCompactSummary?: boolean;
      parentUuid?: string;
      message?: { content?: UserMessageContent };
      summary?: string;
    };
    if (
      rec.type === "user" &&
      rec.isCompactSummary === true &&
      rec.message &&
      rec.message.content !== undefined
    ) {
      const text = flattenUserContent(rec.message.content);
      // Gate on the TRIMMED length so a whitespace-only record (rare, but
      // observed in flush-races where the TUI half-writes content) cannot
      // overwrite a prior real summary just by appearing later in the file.
      if (text.trim().length > 0) {
        latestSummary = text;
        if (boundaryUuid !== undefined && rec.parentUuid === boundaryUuid) {
          matchedByBoundary = text;
        }
      }
      continue;
    }
    if (
      rec.type === "summary" &&
      typeof rec.summary === "string" &&
      rec.summary.trim().length > 0
    ) {
      latestSummary = rec.summary;
    }
  }
  const picked = matchedByBoundary ?? latestSummary;
  if (!picked) return null;
  const trimmed = picked.trim();
  return trimmed.length > 0 ? trimmed : null;
}
