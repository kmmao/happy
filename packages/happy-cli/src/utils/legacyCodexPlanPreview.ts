export type LegacyCodexPlanItem = {
  status: "completed" | "in_progress" | "pending";
  text: string;
};

export type LegacyCodexPlanPreview = {
  explanation: string | null;
  items: LegacyCodexPlanItem[];
};

// A legacy Codex plan message is `formatPlanLine`'s output
// (codexNotificationEvents.ts): one explanation line followed by nothing but
// `[status] step` rows, where status is one of Codex's three update_plan
// states. Both halves of that shape are enforced here — a bare `[a-z_]+`
// prefix matches every bracketed log line ever written (`[vite] …`,
// `[error] …`), and keeping only the lines that happened to match lets one
// incidental log line stand in for a whole prose answer.
//
// Kept in sync with happy-app's sources/components/tools/codexPlanCompat.ts,
// which renders the parsed plan INSTEAD of the message body — there a false
// positive silently deletes prose. The packages cannot import each other.
const PLAN_ITEM_RE = /^\[(completed|in_progress|pending)\]\s+(.+)$/i;

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

  const items: LegacyCodexPlanItem[] = [];
  for (const line of lines.slice(1)) {
    const match = line.match(PLAN_ITEM_RE);
    if (!match) {
      return null;
    }

    const text = match[2].trim();
    if (!text) {
      return null;
    }

    items.push({
      status: match[1].toLowerCase() as LegacyCodexPlanItem["status"],
      text,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return {
    explanation: lines[0] || null,
    items,
  };
}

export function hasLegacyCodexPlanPreview(markdown: string): boolean {
  return parseLegacyCodexPlanPreview(markdown) !== null;
}
