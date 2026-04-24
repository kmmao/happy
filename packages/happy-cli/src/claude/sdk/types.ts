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
  SDKAPIRetryMessage,
  SDKSessionStateChangedMessage,
  SDKDeferredToolUse,
  PermissionResult,
  PermissionDecisionClassification,
  HookPermissionDecision,
  PermissionMode as SdkPermissionMode,
  TerminalReason,
  ThinkingConfig,
  EffortLevel,
  Settings,
  ElicitationRequest,
  ElicitationResult,
  OnElicitation,
  ForkSessionOptions,
  ForkSessionResult,
  AgentDefinition,
  OutputFormat,
  SdkBeta,
  SdkPluginConfig,
  GetSubagentMessagesOptions,
  ListSubagentsOptions,
  // SDK 0.2.119+ additions
  SDKMirrorErrorMessage,
} from "@anthropic-ai/claude-agent-sdk";

export {
  AbortError,
  forkSession,
  getSubagentMessages,
  listSubagents,
} from "@anthropic-ai/claude-agent-sdk";

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
    | "dontAsk"
    | "auto";
  /** Must be true when using permissionMode: 'bypassPermissions'. Passed as --allow-dangerously-skip-permissions to Claude Code. */
  allowDangerouslySkipPermissions?: boolean;
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
  /** Controls how much effort Claude puts into its response */
  effort?: import("@anthropic-ai/claude-agent-sdk").EffortLevel;
  /**
   * API-side task budget in tokens. When set, the model is made aware of
   * its remaining token budget so it can pace tool use and wrap up before
   * the limit. Requires `task-budgets-2026-03-13` beta header.
   * @alpha
   */
  taskBudget?: { total: number };
  /** Enable prompt suggestions — agent emits a prompt_suggestion after each turn */
  promptSuggestions?: boolean;
  /** Callback for handling MCP elicitation requests (user input from MCP servers) */
  onElicitation?: import("@anthropic-ai/claude-agent-sdk").OnElicitation;
  /**
   * Which setting sources to load. Defaults to ['user', 'project', 'local']
   * so that ~/.claude/commands/ and project commands are discovered.
   * Set explicitly to override (e.g. ['project'] for project-only settings).
   */
  settingSources?: Array<"user" | "project" | "local">;
  /**
   * Enable beta features (e.g. 1M context window).
   * @see https://docs.anthropic.com/en/api/beta-headers
   */
  betas?: import("@anthropic-ai/claude-agent-sdk").SdkBeta[];
  /**
   * Enable periodic AI-generated progress summaries for running subagents.
   * Emitted on task_progress events via the summary field (~30s interval).
   */
  agentProgressSummaries?: boolean;
  /**
   * Enable file checkpointing to track file changes during the session.
   * When enabled, files can be rewound to their state at any user message.
   */
  enableFileCheckpointing?: boolean;
  /**
   * Agent name for the main thread. The agent must be defined in the `agents` option or in settings.
   */
  agent?: string;
  /**
   * Programmatically define custom subagents that can be invoked via the Agent tool.
   */
  agents?: Record<string, import("@anthropic-ai/claude-agent-sdk").AgentDefinition>;
  /**
   * Output format configuration for structured JSON responses.
   */
  outputFormat?: import("@anthropic-ai/claude-agent-sdk").OutputFormat;
  /**
   * Load plugins for this session. Plugins provide custom commands, agents, skills, and hooks.
   */
  plugins?: import("@anthropic-ai/claude-agent-sdk").SdkPluginConfig[];
  /**
   * Additional directories Claude can access beyond the current working directory.
   */
  additionalDirectories?: string[];
  /**
   * Custom title for a new session. When provided, the session uses this title
   * instead of auto-generating one from the first user message. When resuming
   * via `resume` or `continue`, the resumed session's persisted title takes
   * precedence — this option only affects newly-created sessions.
   *
   * Maps to the official SDK's `Options.title` introduced in 0.2.119.
   */
  title?: string;
  /**
   * Custom workflow body for the plan-mode system reminder. Replaces the
   * default code-implementation workflow when `permissionMode === 'plan'`.
   * The CLI still wraps this with the read-only enforcement preamble and the
   * ExitPlanMode protocol footer.
   *
   * Maps to the official SDK's `Options.planModeInstructions` introduced in 0.2.119.
   */
  planModeInstructions?: string;
}

/** Query prompt — string or async stream of user messages */
export type QueryPrompt =
  | string
  | AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>;
