/**
 * compatTypes — local type definitions matching the @anthropic-ai/claude-agent-sdk
 * 0.3.145 surface that Happy CLI consumers still type against.
 *
 * Why these live in this package
 * ------------------------------
 * Post-PTY-migration (Phase 6) Happy CLI no longer depends on the SDK at
 * runtime — `claudePtyRuntime` spawns `claude` TUI directly and parses
 * JSONL output. We still keep typed shapes for the messages flowing
 * through `sessionScanner` → `rawToJsonlMessage` → `messageFormatterInk` /
 * `sessionEventReporter`, because removing those types would force a
 * cascade of edits across 30+ consumer files.
 *
 * Maintenance policy
 * ------------------
 * These definitions are frozen at SDK 0.3.145. Future SDK changes are
 * irrelevant — what matters is that they continue to faithfully describe
 * the JSONL records `claude` TUI writes to `~/.claude/projects/…/<id>.jsonl`.
 * Add new fields only when JSONL evolves; do not chase upstream SDK
 * additions that we do not consume.
 *
 * For OPAQUE types (Settings, AgentDefinition, ToolConfig, etc.) we use
 * permissive `Record<string, unknown>` shapes — Happy CLI only forwards
 * these through option bags; it never reads named fields.
 */

import type { BetaMessage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

type UUID = string;

// ─── Local runtime: AbortError ─────────────────────────────────────────────
//
// SDK shipped `AbortError extends Error` as a sentinel for SDK-side aborts.
// We keep an identical shape so any `instanceof AbortError` / `err.name`
// checks in consumer code continue to work.
export class AbortError extends Error {
  constructor(message?: string) {
    super(message ?? "Aborted");
    this.name = "AbortError";
  }
}

// ─── Enum-like literal types ──────────────────────────────────────────────

export type ClaudeJsonlBeta = "context-1m-2025-08-07";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";
export type ClaudeJsonlPermissionMode = PermissionMode;
export type HookPermissionDecision = "allow" | "deny" | "ask" | "defer";
export type PermissionDecisionClassification =
  | "user_temporary"
  | "user_permanent"
  | "user_reject";
export type TerminalReason =
  | "blocking_limit"
  | "rapid_refill_breaker"
  | "prompt_too_long"
  | "image_error"
  | "model_error"
  | "aborted_streaming"
  | "aborted_tools"
  | "stop_hook_prevented"
  | "hook_stopped"
  | "tool_deferred"
  | "max_turns"
  | "completed";
export type ApiKeySource = "user" | "project" | "org" | "temporary" | "none";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PostToolBatch"
  | "Notification"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "StopFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PostCompact"
  | "PermissionRequest"
  | "PermissionDenied"
  | "Setup"
  | "TeammateIdle"
  | "TaskCreated"
  | "TaskCompleted"
  | "Elicitation"
  | "ElicitationResult"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "InstructionsLoaded"
  | "CwdChanged"
  | "FileChanged"
  // MessageDisplay (Claude Code 2.1.152+): display-only hook that replaces the
  // assistant message delta on the TUI screen without altering the stored
  // JSONL message or what the model sees. Happy CLI reads JSONL, so this hook
  // has no effect on the chat envelope sent to mobile/web — listed here only
  // for type completeness against the upstream HookEvent union.
  | "MessageDisplay";

// ─── OPAQUE — Happy CLI only forwards these through option bags ────────────

export type ThinkingConfig = Record<string, unknown>;
export type Settings = Record<string, unknown>;
export type AgentDefinition = Record<string, unknown>;
export type OutputFormat = Record<string, unknown>;
export type ClaudeJsonlPluginConfig = { type: "local"; path: string };
export type GetSubagentMessagesOptions = Record<string, unknown>;
export type ListSubagentsOptions = Record<string, unknown>;
export type HookCallback = (...args: unknown[]) => unknown;
export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
}
export type HookInput = Record<string, unknown>;
export type HookJSONOutput = Record<string, unknown>;
export type ToolConfig = Record<string, Record<string, unknown>>;
export type SessionStore = Record<string, unknown>;
export type SessionStoreEntry = Record<string, unknown>;
export interface SessionKey {
  projectKey: string;
  sessionId: string;
  subpath?: string;
}
export interface ClaudeJsonlSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
}
export type SessionMessage = Record<string, unknown>;
export type McpServerConfig = Record<string, unknown>;
export interface McpServerStatus {
  name: string;
  status: "failed" | "pending" | "connected" | "disabled" | "needs-auth";
  serverInfo?: { name: string; version: string };
  error?: string;
  scope?: string;
  tools?: Array<{ name: string; description?: string }>;
}
export interface SlashCommand {
  name: string;
  description?: string;
}
export interface ModelInfo {
  value: string;
  displayName?: string;
  description?: string | null;
  supportsEffort?: boolean | null;
  supportedEffortLevels?: string[] | null;
  supportsAdaptiveThinking?: boolean | null;
}
export interface AccountInfo {
  email?: string;
  orgUUID?: string;
  organizationName?: string;
}
export interface ForkSessionOptions {
  dir?: string;
  upToMessageId?: string;
  title?: string;
}
export interface ForkSessionResult {
  sessionId: string;
}
export interface ElicitationRequest {
  mcpServerName: string;
  message: string;
  mode?: "form" | "url";
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}
export type ElicitationResult = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};
export type OnElicitation = (
  request: ElicitationRequest,
  options: { signal: AbortSignal },
) => Promise<ElicitationResult>;

export interface PermissionResult {
  behavior: "allow" | "deny" | "ask";
  updatedInput?: Record<string, unknown>;
  message?: string;
  interrupt?: boolean;
  decisionReason?: string;
  updatedPermissions?: unknown;
  classification?: PermissionDecisionClassification;
}

// ─── SDK auxiliary types referenced by message variants ───────────────────

export interface NonNullableUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: Record<string, unknown>;
  service_tier?: string;
}
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUSD?: number;
}
export interface ClaudeJsonlDeferredToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ClaudeJsonlPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}
export type ClaudeJsonlMessageOrigin =
  | { kind: "human" }
  | { kind: "channel"; server: string }
  | { kind: "peer"; from: string; name?: string }
  | { kind: "task-notification" }
  | { kind: "coordinator" };
export type FastModeState = Record<string, unknown>;

// Claude Code 2.1.150 split 529 out of "rate_limit" into a dedicated
// "overloaded" code; "rate_limit" is now reserved for 429. Consumers that
// branched on "rate_limit" must also handle "overloaded" (or check
// `error_status === 529`).
// Claude Code 2.1.162 added "refusal" so callers can detect Anthropic-side
// content refusals without pattern-matching the assistant text.
export type ClaudeJsonlAssistantMessageError =
  | "authentication_failed"
  | "oauth_org_not_allowed"
  | "billing_error"
  | "rate_limit"
  | "overloaded"
  | "refusal"
  | "invalid_request"
  | "model_not_found"
  | "server_error"
  | "unknown"
  | "max_output_tokens";

// ─── SDK message types — STRUCTURAL (consumers introspect every field) ────

export interface ClaudeJsonlAssistantMessage {
  type: "assistant";
  message: BetaMessage;
  parent_tool_use_id: string | null;
  error?: ClaudeJsonlAssistantMessageError;
  uuid: UUID;
  session_id: string;
  request_id?: string;
  subagent_type?: string;
  task_description?: string;
}

export interface ClaudeJsonlUserMessage {
  type: "user";
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  priority?: "now" | "next" | "later";
  origin?: ClaudeJsonlMessageOrigin;
  shouldQuery?: boolean;
  timestamp?: string;
  uuid?: UUID;
  session_id?: string;
  subagent_type?: string;
  task_description?: string;
}

export interface ClaudeJsonlSystemMessage {
  type: "system";
  subtype: "init";
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: Array<{ name: string; path: string }>;
  fast_mode_state?: FastModeState;
  /**
   * Session title set via SessionStart hook's hookSpecificOutput.sessionTitle
   * (Claude Code 2.1.152+). Claude Code may surface this on the init system
   * message so consumers can pick it up without scanning later `custom-title`
   * records. `sessionStoreRpc.buildSessionInfo` reads it as a fallback when
   * no `custom-title` record is present.
   */
  session_title?: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlStatusMessage {
  type: "system";
  subtype: "status";
  status: "compacting" | "requesting" | null;
  permissionMode?: PermissionMode;
  compact_result?: "success" | "failed";
  compact_error?: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlCompactBoundaryMessage {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
    post_tokens?: number;
    duration_ms?: number;
    preserved_segment?: {
      head_uuid: UUID;
      anchor_uuid: UUID;
      tail_uuid: UUID;
    };
    preserved_messages?: {
      anchor_uuid: UUID;
      uuids: UUID[];
    };
  };
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlMirrorErrorMessage {
  type: "system";
  subtype: "mirror_error";
  error: string;
  key: { projectKey: string; sessionId: string; subpath?: string };
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlNotificationMessage {
  type: "system";
  subtype: "notification";
  key: string;
  text: string;
  priority: "low" | "medium" | "high" | "immediate";
  color?: string;
  timeout_ms?: number;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlPartialAssistantMessage {
  type: "stream_event";
  event: BetaRawMessageStreamEvent;
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
  ttft_ms?: number;
}

export interface ClaudeJsonlPermissionDeniedMessage {
  type: "system";
  subtype: "permission_denied";
  tool_name: string;
  tool_use_id: string;
  agent_id?: string;
  decision_reason_type?: string;
  decision_reason?: string;
  message: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlPromptSuggestionMessage {
  type: "prompt_suggestion";
  suggestion: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlRateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage";
  utilization?: number;
  overageStatus?: "allowed" | "allowed_warning" | "rejected";
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}

export interface ClaudeJsonlRateLimitEvent {
  type: "rate_limit_event";
  rate_limit_info: ClaudeJsonlRateLimitInfo;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlAPIRetryMessage {
  type: "system";
  subtype: "api_retry";
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status: number | null;
  error: ClaudeJsonlAssistantMessageError;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlSessionStateChangedMessage {
  type: "system";
  subtype: "session_state_changed";
  state: "idle" | "running" | "requires_action";
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlMemoryRecallMessage {
  type: "system";
  subtype: "memory_recall";
  mode: "select" | "synthesize";
  memories: Array<{
    path: string;
    scope: "personal" | "team";
    content?: string;
  }>;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlTaskNotificationMessage {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  tool_use_id?: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
  skip_transcript?: boolean;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlTaskProgressMessage {
  type: "system";
  subtype: "task_progress";
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  usage: { total_tokens: number; tool_uses: number; duration_ms: number };
  last_tool_name?: string;
  summary?: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlTaskStartedMessage {
  type: "system";
  subtype: "task_started";
  task_id: string;
  tool_use_id?: string;
  description: string;
  subagent_type?: string;
  task_type?: string;
  workflow_name?: string;
  prompt?: string;
  skip_transcript?: boolean;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlTaskUpdatedMessage {
  type: "system";
  subtype: "task_updated";
  task_id: string;
  patch: {
    status?: "pending" | "running" | "completed" | "failed" | "killed" | "paused";
    description?: string;
    end_time?: number;
    total_paused_ms?: number;
    error?: string;
    is_backgrounded?: boolean;
  };
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlToolProgressMessage {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  task_id?: string;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlToolUseSummaryMessage {
  type: "tool_use_summary";
  summary: string;
  preceding_tool_use_ids: string[];
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlResultSuccess {
  type: "result";
  subtype: "success";
  duration_ms: number;
  duration_api_ms: number;
  ttft_ms?: number;
  is_error: boolean;
  api_error_status?: number | null;
  num_turns: number;
  result: string;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: ClaudeJsonlPermissionDenial[];
  structured_output?: unknown;
  deferred_tool_use?: ClaudeJsonlDeferredToolUse;
  terminal_reason?: TerminalReason;
  fast_mode_state?: FastModeState;
  origin?: ClaudeJsonlMessageOrigin;
  uuid: UUID;
  session_id: string;
}

export interface ClaudeJsonlResultError {
  type: "result";
  subtype:
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: ClaudeJsonlPermissionDenial[];
  errors: string[];
  terminal_reason?: TerminalReason;
  fast_mode_state?: FastModeState;
  origin?: ClaudeJsonlMessageOrigin;
  uuid: UUID;
  session_id: string;
}

export type ClaudeJsonlResultMessage = ClaudeJsonlResultSuccess | ClaudeJsonlResultError;

export type ClaudeJsonlMessage =
  | ClaudeJsonlAssistantMessage
  | ClaudeJsonlUserMessage
  | ClaudeJsonlResultMessage
  | ClaudeJsonlSystemMessage
  | ClaudeJsonlPartialAssistantMessage
  | ClaudeJsonlCompactBoundaryMessage
  | ClaudeJsonlStatusMessage
  | ClaudeJsonlAPIRetryMessage
  | ClaudeJsonlToolProgressMessage
  | ClaudeJsonlTaskNotificationMessage
  | ClaudeJsonlTaskStartedMessage
  | ClaudeJsonlTaskUpdatedMessage
  | ClaudeJsonlTaskProgressMessage
  | ClaudeJsonlSessionStateChangedMessage
  | ClaudeJsonlNotificationMessage
  | ClaudeJsonlToolUseSummaryMessage
  | ClaudeJsonlMemoryRecallMessage
  | ClaudeJsonlRateLimitEvent
  | ClaudeJsonlPermissionDeniedMessage
  | ClaudeJsonlPromptSuggestionMessage
  | ClaudeJsonlMirrorErrorMessage;
