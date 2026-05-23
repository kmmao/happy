/**
 * Claude SDK type-compat barrel for Happy CLI.
 *
 * Post-PTY-migration (Phase 6+) this module no longer wraps the official
 * `@anthropic-ai/claude-agent-sdk` runtime — it only re-exports the type
 * surface that downstream code is still typed against. The runtime
 * `query()` driver was replaced by `claudePtyRuntime` + `sessionScanner`.
 */

export { AbortError } from "./types"
export type {
  QueryOptions,
  QueryPrompt,
  ClaudeJsonlMessage,
  ClaudeJsonlUserMessage,
  ClaudeJsonlAssistantMessage,
  ClaudeJsonlSystemMessage,
  ClaudeJsonlResultMessage,
  ClaudeJsonlResultSuccess,
  ClaudeJsonlResultError,
  CanCallToolCallback,
  PermissionResult,
  ClaudeJsonlBeta,
  ClaudeJsonlStatusMessage,
  ClaudeJsonlCompactBoundaryMessage,
  ClaudeJsonlTaskStartedMessage,
  ClaudeJsonlTaskProgressMessage,
  ClaudeJsonlTaskUpdatedMessage,
  ClaudeJsonlTaskNotificationMessage,
  ClaudeJsonlAPIRetryMessage,
  ClaudeJsonlToolProgressMessage,
  ClaudeJsonlPromptSuggestionMessage,
  ClaudeJsonlSessionStateChangedMessage,
  ClaudeJsonlMemoryRecallMessage,
  ClaudeJsonlRateLimitEvent,
} from "./types"
