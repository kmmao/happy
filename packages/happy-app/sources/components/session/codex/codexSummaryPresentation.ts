export interface CodexSessionSummary {
  goal: string;
  currentFocus?: string;
  keyDecisions?: string[];
  openQuestions?: string[];
  impactScope?: string[];
  updatedAt: number;
}

export interface CodexSummaryEntry {
  id: "goal" | "currentFocus";
  value: string;
}

function normalizeSummaryValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildCodexSummaryEntries(
  summary: Pick<CodexSessionSummary, "goal" | "currentFocus">,
): CodexSummaryEntry[] {
  const entries: CodexSummaryEntry[] = [];

  const goal = normalizeSummaryValue(summary.goal);
  if (goal) {
    entries.push({
      id: "goal",
      value: goal,
    });
  }

  const currentFocus = normalizeSummaryValue(summary.currentFocus);
  if (currentFocus) {
    entries.push({
      id: "currentFocus",
      value: currentFocus,
    });
  }

  return entries;
}
