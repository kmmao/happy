export function getProgressRefreshPromptKey(
  flavor: string | null | undefined,
):
  | "session.progressRefreshPrompt"
  | "session.progressRefreshPromptCodex" {
  return flavor?.toLowerCase() === "codex"
    ? "session.progressRefreshPromptCodex"
    : "session.progressRefreshPrompt";
}
