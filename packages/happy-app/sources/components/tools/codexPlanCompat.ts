export type LegacyCodexPlanItem = {
  status: "completed" | "in_progress" | "pending" | "unknown";
  text: string;
};

export type LegacyCodexPlanPreview = {
  explanation: string | null;
  items: LegacyCodexPlanItem[];
};

const planCache = new Map<string, LegacyCodexPlanPreview | null>();

export function parseLegacyCodexPlanPreview(
  markdown: string,
): LegacyCodexPlanPreview | null {
  const cached = planCache.get(markdown);
  if (cached !== undefined) return cached;

  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    if (planCache.size > 500) planCache.clear();
    planCache.set(markdown, null);
    return null;
  }

  const explanation = lines[0] || null;
  const items = lines
    .slice(1)
    .map((line) => {
      const match = line.match(/^\[([a-z_]+)\]\s+(.+)$/i);
      if (!match) {
        return null;
      }

      const rawStatus = match[1].toLowerCase();
      const status: LegacyCodexPlanItem["status"] =
        rawStatus === "completed" ||
        rawStatus === "in_progress" ||
        rawStatus === "pending"
          ? rawStatus
          : "unknown";

      const text = match[2].trim();
      if (!text) {
        return null;
      }

      return { status, text };
    })
    .filter((item): item is LegacyCodexPlanItem => item !== null);

  const result = items.length === 0 ? null : { explanation, items };
  if (planCache.size > 500) planCache.clear();
  planCache.set(markdown, result);
  return result;
}
