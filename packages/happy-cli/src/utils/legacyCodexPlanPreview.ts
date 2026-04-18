export type LegacyCodexPlanItem = {
  status: "completed" | "in_progress" | "pending" | "unknown";
  text: string;
};

export type LegacyCodexPlanPreview = {
  explanation: string | null;
  items: LegacyCodexPlanItem[];
};

export function parseLegacyCodexPlanPreview(
  markdown: string,
): LegacyCodexPlanPreview | null {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
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

  if (items.length === 0) {
    return null;
  }

  return {
    explanation,
    items,
  };
}

export function hasLegacyCodexPlanPreview(markdown: string): boolean {
  return parseLegacyCodexPlanPreview(markdown) !== null;
}
