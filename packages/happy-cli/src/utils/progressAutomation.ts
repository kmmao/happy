import {
  isHappyMcpToolAlias,
} from "@kmmao/happy-wire";

type ProgressLikeTodo = {
  status: "pending" | "in_progress" | "completed";
};

export const HAPPY_AUTO_PROGRESS_SOURCE = "happy-cli-auto-progress";
export const HAPPY_AUTO_SUMMARY_SOURCE = "happy-cli-auto-summary";

export function isHappyAutomationSource(
  source: string | null | undefined,
): boolean {
  return (
    source === HAPPY_AUTO_PROGRESS_SOURCE || source === HAPPY_AUTO_SUMMARY_SOURCE
  );
}

export function isHappyProgressToolName(
  toolName: string | null | undefined,
): boolean {
  return isHappyMcpToolAlias(toolName, "update_progress");
}

export function isHappySummaryToolName(
  toolName: string | null | undefined,
): boolean {
  return isHappyMcpToolAlias(toolName, "update_session_summary");
}

export function didChecklistTransitionToCompleted(args: {
  priorTodos: readonly ProgressLikeTodo[];
  nextTodos: readonly ProgressLikeTodo[];
  alreadyGenerated: boolean;
}): boolean {
  if (args.alreadyGenerated) {
    return false;
  }

  const oldHadIncomplete = args.priorTodos.some(
    (todo) => todo.status !== "completed",
  );
  const newAllCompleted =
    args.nextTodos.length > 0 &&
    args.nextTodos.every((todo) => todo.status === "completed");

  return oldHadIncomplete && newAllCompleted;
}

export function shouldTriggerCodexAutoProgress(args: {
  source: string | null | undefined;
  sawPlanUpdate: boolean;
  sawFileChanges: boolean;
  sawDiffUpdate: boolean;
  wroteProgress: boolean;
}): boolean {
  if (isHappyAutomationSource(args.source)) {
    return false;
  }
  if (args.wroteProgress) {
    return false;
  }

  return args.sawPlanUpdate || args.sawFileChanges || args.sawDiffUpdate;
}

export function buildAutoProgressSyntheticPrompt(): string {
  return (
    "[Auto-triggered after meaningful turn activity]\n" +
    "This turn materially changed the active plan and/or file changes, so the Progress tab may now be stale. " +
    "If the active checklist, currentStage, or blockers need refreshing, call mcp__happy__update_progress now. " +
    "If the Progress tab is already accurate, acknowledge briefly without calling."
  );
}

export function buildAutoSummarySyntheticPrompt(): string {
  return (
    "[Auto-triggered by checklist completion]\n" +
    "The session's active checklist just transitioned from having pending/in_progress items to fully completed. " +
    "If the session summary needs updating to reflect what was accomplished, call mcp__happy__update_session_summary now. " +
    "If the summary is already accurate, acknowledge briefly without calling."
  );
}
