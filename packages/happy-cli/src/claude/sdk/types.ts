/**
 * SDK types — re-exports from official @anthropic-ai/claude-agent-sdk
 * with adapter-specific types for Happy CLI.
 */

// ── Official SDK re-exports ──
export type {
  SDKMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk"

export { AbortError } from "@anthropic-ai/claude-agent-sdk"

// ── Adapter-specific types (our API, not the official SDK's) ──

/** Callback for tool permission checks (adapter signature) */
export interface CanCallToolCallback {
  (toolName: string, input: unknown, options: { signal: AbortSignal }): Promise<
    import("@anthropic-ai/claude-agent-sdk").PermissionResult
  >
}

/** Adapter query options — maps to official Options internally via queryAdapter */
export interface QueryOptions {
  abort?: AbortSignal
  allowedTools?: string[]
  appendSystemPrompt?: string
  customSystemPrompt?: string
  cwd?: string
  disallowedTools?: string[]
  executable?: string
  executableArgs?: string[]
  maxTurns?: number
  mcpServers?: Record<string, unknown>
  pathToClaudeCodeExecutable?: string
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"
  continue?: boolean
  resume?: string
  model?: string
  fallbackModel?: string
  strictMcpConfig?: boolean
  canCallTool?: CanCallToolCallback
  /** Path to a settings JSON file to pass to Claude via --settings */
  settingsPath?: string
}

/** Query prompt — string or async stream of user messages */
export type QueryPrompt =
  | string
  | AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>
