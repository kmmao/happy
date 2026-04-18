import type { Metadata } from "@/api/types";

export function resolveCodexResumeThreadId(
  metadata: Metadata | null | undefined,
): string | null {
  const threadId = metadata?.codex?.threadId;
  if (!threadId) {
    return null;
  }
  if (metadata?.codex?.resolvedBackend === "codex-mcp-legacy") {
    return null;
  }
  return threadId;
}
