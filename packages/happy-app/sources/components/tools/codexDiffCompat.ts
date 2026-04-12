export type LegacyCodexDiffPreview = {
  prefixMarkdown: string | null;
  unifiedDiff: string;
};

const DIFF_PREVIEW_MARKER = "Latest diff preview:";

export function parseLegacyCodexDiffPreview(
  markdown: string,
): LegacyCodexDiffPreview | null {
  if (!markdown.includes(DIFF_PREVIEW_MARKER)) {
    return null;
  }

  const match = markdown.match(
    /([\s\S]*?)Latest diff preview:\s*\n\s*```diff\n([\s\S]*?)\n```([\s\S]*)$/,
  );

  if (!match) {
    return null;
  }

  const before = match[1]?.trim() || "";
  const diff = match[2]?.trimEnd() || "";
  const after = match[3]?.trim() || "";

  if (!diff) {
    return null;
  }

  const prefixParts = [before, after].filter((part) => part.length > 0);

  return {
    prefixMarkdown: prefixParts.length > 0 ? prefixParts.join("\n\n") : null,
    unifiedDiff: diff,
  };
}
