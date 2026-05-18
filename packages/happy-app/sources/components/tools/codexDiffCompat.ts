export type LegacyCodexDiffPreview = {
  prefixMarkdown: string | null;
  unifiedDiff: string;
};

const DIFF_PREVIEW_MARKER = "Latest diff preview:";

function simplifyLocalFileLinks(markdown: string): string {
  return markdown.replace(
    /\[([^\]]+)\]\((\/[^)\s]+)\)/g,
    (_match, label: string) => `\`${label}\``,
  );
}

const diffCache = new Map<string, LegacyCodexDiffPreview | null>();

export function parseLegacyCodexDiffPreview(
  markdown: string,
): LegacyCodexDiffPreview | null {
  const cached = diffCache.get(markdown);
  if (cached !== undefined) return cached;

  let result: LegacyCodexDiffPreview | null = null;

  if (markdown.includes(DIFF_PREVIEW_MARKER)) {
    const match = markdown.match(
      /([\s\S]*?)Latest diff preview:\s*\n\s*```diff\n([\s\S]*?)\n```([\s\S]*)$/,
    );

    if (match) {
      const before = match[1]?.trim() || "";
      const diff = match[2]?.trimEnd() || "";
      const after = match[3]?.trim() || "";

      if (diff) {
        const prefixParts = [before, after].filter((part) => part.length > 0);
        result = {
          prefixMarkdown:
            prefixParts.length > 0
              ? simplifyLocalFileLinks(prefixParts.join("\n\n"))
              : null,
          unifiedDiff: diff,
        };
      }
    }
  }

  if (diffCache.size > 500) diffCache.clear();
  diffCache.set(markdown, result);
  return result;
}
