export type LegacyCodexPlanItem = {
  status: "completed" | "in_progress" | "pending";
  text: string;
};

export type LegacyCodexPlanPreview = {
  explanation: string | null;
  items: LegacyCodexPlanItem[];
};

// A legacy Codex plan message is `formatPlanLine`'s output (happy-cli
// codexNotificationEvents.ts): one explanation line followed by nothing but
// `[status] step` rows, where status is one of Codex's three update_plan
// states.
//
// Both halves of that shape are load-bearing, because MessageView renders the
// plan card INSTEAD of the markdown body and chatTimelineDisplay can hide the
// message outright — a false positive silently deletes prose:
//
//  - Status vocabulary is closed. The old `[a-z_]+` + "unknown" fallback
//    matched every bracketed log prefix ever written — `[vite]`, `[error]`,
//    `[npm]`, `[info]`.
//  - EVERY line after the explanation must be an item. The old parser kept
//    whichever lines happened to match and dropped the rest, so one incidental
//    `[vite] …` line inside a long answer swallowed the whole answer.
//
// An unrecognised status now falls through to plain markdown — the message
// renders in full, which is the safe failure direction.
const PLAN_ITEM_RE = /^\[(completed|in_progress|pending)\]\s+(.+)$/i;

const planCache = new Map<string, LegacyCodexPlanPreview | null>();

export function parseLegacyCodexPlanPreview(
  markdown: string,
): LegacyCodexPlanPreview | null {
  const cached = planCache.get(markdown);
  if (cached !== undefined) return cached;

  const result = parsePlan(markdown);
  if (planCache.size > 500) planCache.clear();
  planCache.set(markdown, result);
  return result;
}

function parsePlan(markdown: string): LegacyCodexPlanPreview | null {
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

  return { explanation: lines[0] || null, items };
}
