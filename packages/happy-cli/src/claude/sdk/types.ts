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
  ThinkingConfig,
  Settings,
} from "@anthropic-ai/claude-agent-sdk";

export { AbortError } from "@anthropic-ai/claude-agent-sdk";

// ── Adapter-specific types (our API, not the official SDK's) ──

/** Callback for tool permission checks (adapter signature) */
export interface CanCallToolCallback {
  (
    toolName: string,
    input: unknown,
    options: { signal: AbortSignal },
  ): Promise<import("@anthropic-ai/claude-agent-sdk").PermissionResult>;
}

/** Adapter query options — maps to official Options internally via queryAdapter */
export interface QueryOptions {
  abort?: AbortSignal;
  allowedTools?: string[];
  appendSystemPrompt?: string;
  customSystemPrompt?: string;
  cwd?: string;
  disallowedTools?: string[];
  executable?: string;
  executableArgs?: string[];
  maxTurns?: number;
  mcpServers?: Record<string, unknown>;
  pathToClaudeCodeExecutable?: string;
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk";
  continue?: boolean;
  resume?: string;
  model?: string;
  fallbackModel?: string;
  strictMcpConfig?: boolean;
  canCallTool?: CanCallToolCallback;
  /**
   * Settings to pass to Claude — path to a JSON file or an inline settings object.
   * Maps to the SDK's `settings` option (highest-priority flag settings layer).
   * Prefer this over `settingsPath`.
   */
  settings?: string | import("@anthropic-ai/claude-agent-sdk").Settings;
  /** @deprecated Use `settings` instead. Path to a settings JSON file. */
  settingsPath?: string;
  /** Maximum USD budget for this query — SDK returns error_max_budget_usd when exceeded */
  maxBudgetUsd?: number;
  /** Controls Claude's thinking/reasoning behavior */
  thinking?: import("@anthropic-ai/claude-agent-sdk").ThinkingConfig;
  /** Controls how much effort Claude puts into its response (low/medium/high/max) */
  effort?: "low" | "medium" | "high" | "max";
  /** Enable prompt suggestions — agent emits a prompt_suggestion after each turn */
  promptSuggestions?: boolean;
}

/** Query prompt — string or async stream of user messages */
export type QueryPrompt =
  | string
  | AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>;
