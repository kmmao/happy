/**
 * Claude Code SDK integration for Happy CLI
 *
 * Uses official @anthropic-ai/claude-agent-sdk via adapter layer.
 */

export { query } from "./queryAdapter"
export { AbortError } from "./types"
export type {
  QueryOptions,
  QueryPrompt,
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKControlResponse,
  ControlRequest,
  InterruptRequest,
  SDKControlRequest,
  CanCallToolCallback,
  PermissionResult,
} from "./types"

export type { AdaptedQuery } from "./queryAdapter"
