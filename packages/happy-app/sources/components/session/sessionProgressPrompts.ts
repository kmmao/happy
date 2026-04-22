export function getProgressRefreshPromptKey(
  flavor: string | null | undefined,
):
  | "session.progressRefreshPrompt"
  | "session.progressRefreshPromptCodex" {
  return flavor?.toLowerCase() === "codex"
    ? "session.progressRefreshPromptCodex"
    : "session.progressRefreshPrompt";
}

export type ProgressTodoPromptAction = "verify" | "continue" | "issue";
export type ProgressTodoPromptStatus =
  | "pending"
  | "in_progress"
  | "completed";

export function getProgressTodoPromptKey(
  flavor: string | null | undefined,
  status: ProgressTodoPromptStatus,
  action: ProgressTodoPromptAction,
):
  | "session.progressTodoPromptVerifyCompleted"
  | "session.progressTodoPromptVerifyActive"
  | "session.progressTodoPromptContinueTodoWrite"
  | "session.progressTodoPromptIssueCompleted"
  | "session.progressTodoPromptIssueActive"
  | "session.progressTodoPromptVerifyCompletedCodex"
  | "session.progressTodoPromptVerifyActiveCodex"
  | "session.progressTodoPromptContinueCodex"
  | "session.progressTodoPromptIssueCompletedCodex"
  | "session.progressTodoPromptIssueActiveCodex" {
  const isCodex = flavor?.toLowerCase() === "codex";

  if (action === "continue") {
    return isCodex
      ? "session.progressTodoPromptContinueCodex"
      : "session.progressTodoPromptContinueTodoWrite";
  }

  if (action === "verify") {
    if (status === "completed") {
      return isCodex
        ? "session.progressTodoPromptVerifyCompletedCodex"
        : "session.progressTodoPromptVerifyCompleted";
    }
    return isCodex
      ? "session.progressTodoPromptVerifyActiveCodex"
      : "session.progressTodoPromptVerifyActive";
  }

  if (status === "completed") {
    return isCodex
      ? "session.progressTodoPromptIssueCompletedCodex"
      : "session.progressTodoPromptIssueCompleted";
  }

  return isCodex
    ? "session.progressTodoPromptIssueActiveCodex"
    : "session.progressTodoPromptIssueActive";
}
