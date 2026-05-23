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
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  CanCallToolCallback,
  PermissionResult,
  SdkBeta,
  SDKStatusMessage,
  SDKCompactBoundaryMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
  SDKAPIRetryMessage,
  SDKToolProgressMessage,
  SDKPromptSuggestionMessage,
  SDKSessionStateChangedMessage,
  SDKMemoryRecallMessage,
  SDKRateLimitEvent,
} from "./types"
