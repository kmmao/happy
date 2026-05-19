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
  // SDK 0.2.139+ additions
  SDKPermissionDeniedMessage,
  // SDK 0.3.142+ additions
  SDKTaskUpdatedMessage,
  SDKRateLimitEvent,
  SDKToolUseSummaryMessage,
  SDKNotificationMessage,
  SDKPartialAssistantMessage,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  ToolConfig,
  SessionStore,
  SessionStoreEntry,
  SessionKey,
  SDKSessionInfo,
  SessionMessage,
  McpServerConfig,
  McpServerStatus,
  SlashCommand,
  ModelInfo,
  AccountInfo,
} from "@anthropic-ai/claude-agent-sdk";

export {
  AbortError,
  forkSession,
  getSubagentMessages,
  listSubagents,
  // SDK 0.3.142+ additions
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession,
  resolveSettings,
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
  /**
   * Adapter that mirrors session transcript entries to an external store.
   * When set, the SDK still writes to CLAUDE_CONFIG_DIR AND emits entries
   * to this adapter via dual-write. Currently used as an observability hook
   * behind the `HAPPY_USE_SESSION_STORE` env flag — see
   * `sessionStoreAdapter.ts`.
   *
   * Maps to the official SDK's `Options.sessionStore` (@alpha, 0.2.119+).
   */
  sessionStore?: import("@anthropic-ai/claude-agent-sdk").SessionStore;
  /**
   * Per-tool configuration for built-in tools.
   * Used to configure AskUserQuestion's previewFormat so the model emits
   * markdown preview content in option objects.
   *
   * Maps to the official SDK's `Options.toolConfig` (0.2.119+).
   */
  toolConfig?: import("@anthropic-ai/claude-agent-sdk").ToolConfig;
  /**
   * Forward subagent text and thinking blocks as assistant/user messages so
   * consumers can render complete nested subagent conversation flows.
   * By default only tool_use/tool_result blocks are forwarded.
   *
   * Maps to the official SDK's `Options.forwardSubagentText` (0.2.133+).
   */
  forwardSubagentText?: boolean;
  /**
   * Include partial/streaming message events (SDKPartialAssistantMessage)
   * in the query output. When true, the SDK emits `type: 'stream_event'`
   * for each API SSE chunk, enabling real-time text-delta forwarding.
   *
   * Maps to the official SDK's `Options.includePartialMessages` (0.3.143+).
   */
  includePartialMessages?: boolean;
  /**
   * Hook callbacks for responding to events during agent execution.
   * Hooks can modify behavior, add context, or implement custom logic
   * at key lifecycle points (tool use, session start/end, compaction, etc.).
   *
   * Complementary to the existing RPC mechanism — hooks run in-process
   * within the SDK, while RPC handlers communicate over the network.
   * Use hooks for low-latency, synchronous interception; use RPC for
   * cross-device orchestration from the App.
   *
   * @example
   * ```typescript
   * hooks: {
   *   PostToolUse: [{
   *     hooks: [async (input) => ({ continue: true })]
   *   }],
   *   Stop: [{
   *     hooks: [async (input) => ({ continue: true })]
   *   }]
   * }
   * ```
   *
   * Maps to the official SDK's `Options.hooks` (0.3.142+).
   */
  hooks?: Partial<Record<import("@anthropic-ai/claude-agent-sdk").HookEvent, import("@anthropic-ai/claude-agent-sdk").HookCallbackMatcher[]>>;
  /**
   * Use a specific session ID instead of an auto-generated UUID.
   * Must be a valid UUID. Cannot be used with `continue` or `resume` unless
   * `forkSession` is also set.
   *
   * Maps to the official SDK's `Options.sessionId` (0.3.142+).
   */
  sessionId?: string;
  /**
   * When resuming, only resume messages up to and including the message
   * with this UUID. Use with `resume`. The message ID should be from
   * `SDKAssistantMessage.uuid`.
   *
   * Maps to the official SDK's `Options.resumeSessionAt` (0.3.142+).
   */
  resumeSessionAt?: string;
  /**
   * Controls how aggressively transcript entries are flushed to the
   * sessionStore. `'eager'` gives near-real-time sync; `'batched'`
   * (default) groups writes for efficiency. Ignored when sessionStore
   * is not set.
   *
   * Maps to the official SDK's `Options.sessionStoreFlush` (0.3.142+).
   * @alpha
   */
  sessionStoreFlush?: 'batched' | 'eager';
  /**
   * When false, disables session persistence to disk. Sessions will not be
   * saved to ~/.claude/projects/ and cannot be resumed later. Useful for
   * ephemeral or automated workflows.
   *
   * Maps to the official SDK's `Options.persistSession` (0.3.142+).
   * @default true
   */
  persistSession?: boolean;
  /**
   * Map model-emitted tool names to alternative tool implementations.
   * When the model calls tool `A` and `toolAliases` contains `{ A: 'B' }`,
   * the SDK routes the call to tool `B` instead.
   *
   * Use case: redirect `Bash` to a remote sandbox MCP tool without changing
   * model behavior. Example: `{ Bash: 'mcp__workspace__bash' }`.
   *
   * Maps to the official SDK's `Options.toolAliases` (0.3.142+).
   */
  toolAliases?: Record<string, string>;
}

/** Query prompt — string or async stream of user messages */
export type QueryPrompt =
  | string
  | AsyncIterable<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>;
