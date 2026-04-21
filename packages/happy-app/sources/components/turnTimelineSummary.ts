import type { Metadata } from "@/sync/storageTypes";
import type { TurnTimelineStep } from "./chatTimelineDisplay";
import { getCodexParsedCommandSummary } from "./tools/codexCommandUtils";

export type HiddenTimelineSummaryKind =
  | "thinking"
  | "read"
  | "write"
  | "search"
  | "list_files"
  | "verify"
  | "test"
  | "git"
  | "package"
  | "run"
  | "patch"
  | "diff"
  | "progress"
  | "tool";

export interface HiddenTimelineSummaryItem {
  readonly kind: HiddenTimelineSummaryKind;
  readonly count: number;
}

export interface HiddenTimelineSummary {
  readonly items: readonly HiddenTimelineSummaryItem[];
  readonly otherCount: number;
}

function classifyHiddenStep(
  step: TurnTimelineStep,
  metadata: Metadata | null,
): HiddenTimelineSummaryKind {
  if (step.kind === "thinking") {
    return "thinking";
  }

  switch (step.message.tool.name) {
    case "CodexBash": {
      const summary = getCodexParsedCommandSummary(step.message.tool.input, metadata);
      return (summary?.type ?? "tool") as HiddenTimelineSummaryKind;
    }
    case "CodexPatch":
      return "patch";
    case "CodexDiff":
      return "diff";
    case "mcp__happy__update_progress":
      return "progress";
    default:
      return "tool";
  }
}

const SUMMARY_PRIORITY: HiddenTimelineSummaryKind[] = [
  "thinking",
  "read",
  "write",
  "search",
  "list_files",
  "verify",
  "test",
  "git",
  "package",
  "run",
  "patch",
  "diff",
  "progress",
  "tool",
];

export function summarizeHiddenTimelineSteps(
  steps: readonly TurnTimelineStep[],
  metadata: Metadata | null,
  topN = 2,
): HiddenTimelineSummary {
  if (steps.length === 0) {
    return {
      items: [],
      otherCount: 0,
    };
  }

  const counts = new Map<HiddenTimelineSummaryKind, number>();
  for (const step of steps) {
    const kind = classifyHiddenStep(step, metadata);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  const sorted = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return (
        SUMMARY_PRIORITY.indexOf(left.kind) - SUMMARY_PRIORITY.indexOf(right.kind)
      );
    });

  const items = sorted.slice(0, topN);
  const otherCount = sorted
    .slice(topN)
    .reduce((sum, item) => sum + item.count, 0);

  return {
    items,
    otherCount,
  };
}
