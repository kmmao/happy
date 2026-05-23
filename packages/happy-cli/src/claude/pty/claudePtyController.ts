/**
 * claudePtyController — a `Query`-shaped controller backed by a PTY.
 *
 * Why this exists
 * ---------------
 * Before the PTY migration the launcher consumed `OfficialQuery` from
 * `@anthropic-ai/claude-agent-sdk` for runtime control:
 *
 *   • `interrupt()`           — abort the in-flight model call
 *   • `stopTask(taskId)`      — stop a specific subagent task
 *   • `backgroundTasks(id)`   — fetch background-task state
 *   • `seedReadState(p, m)`   — pre-warm the file-read cache after compact
 *   • `setModel(model)`       — hot-swap model mid-conversation
 *   • `setPermissionMode(m)`  — hot-swap permission mode mid-conversation
 *   • `setMcpServers(map)`    — hot-add/remove MCP servers
 *   • `applyFlagSettings(s)`  — patch the SDK's Settings layer at runtime
 *
 * Claude TUI has equivalents for none of these as programmatic APIs — most
 * are SDK-only conveniences. Rather than tear out every call site in the
 * 2.6k-line launcher, we keep the same call surface here, redirected to
 * the closest PTY behaviour:
 *
 *   • interrupt()          → write Ctrl-C (0x03) to PTY stdin
 *   • everything else      → no-op + debug log (visibility loss is logged,
 *                            not silently swallowed)
 *
 * Trade-offs were accepted in the PTY migration plan: hot-swap model /
 * permission mode is now a cold restart driven by the launcher's
 * `coldModeHash`, and `applyFlagSettings` patches happen at PTY spawn
 * time (via `buildClaudeCliFlags` + temporary settings.json) rather than
 * at runtime.
 *
 * Type compatibility
 * ------------------
 * The returned object is shaped to match the subset of `OfficialQuery`
 * the launcher actually calls. It is NOT a full implementation of the
 * SDK interface, and consumers must not rely on returned values from
 * the no-op methods.
 *
 * getContextUsage — PTY implementation
 * -------------------------------------
 * The SDK's `getContextUsage()` queries a live in-process runtime object.
 * In PTY mode there is no such object. Instead, `claudeRemote.ts` tracks
 * the latest `assistant` message usage fields (input_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens) from the session
 * JSONL scanner and passes a `getLatestUsage` getter at construction time.
 *
 * What we can reconstruct from session data:
 *   ✓ totalTokens  — sum of all three input buckets (the actual context window)
 *   ✓ maxTokens    — derived from model name via a hardcoded lookup table
 *   ✓ percentage   — totalTokens / maxTokens * 100
 *   ✓ model        — from assistant message
 *   ✓ apiUsage     — direct mapping of the four raw fields
 *   ✓ categories   — single "Conversation" bucket (no SDK-level breakdown)
 *
 * What remains unavailable in PTY mode:
 *   ✗ categories breakdown (system prompt / tools / memory / messages)
 *   ✗ memoryFiles, mcpTools, systemPromptSections (not in session JSONL)
 *   ✗ messageBreakdown per-category (would require parsing every message)
 */

import type { ClaudePtyHandle } from "./claudePtyRuntime";
import { logger } from "@/ui/logger";

// ── UsageSnapshot ─────────────────────────────────────────────────────────────

/**
 * Raw token-usage extracted from the latest `assistant` JSONL message.
 * Populated by `claudeRemote.ts` as the session scanner emits messages;
 * consumed by `getContextUsage()` to synthesise a context-usage response.
 */
export interface UsageSnapshot {
  model: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

// ── Happy-managed MCP server names ───────────────────────────────────────────

/**
 * Servers injected by the Happy launcher at spawn time. They are always
 * successfully connected (Happy controls their lifecycle), so we report
 * them as "connected" rather than "pending".
 */
const HAPPY_MANAGED_SERVERS = new Set(["happy", "happy-knowledge"]);

// ── Model context-window limits ───────────────────────────────────────────────

/**
 * Known model → context window (input tokens) mapping.
 * All current Claude models share a 200k context window.
 * Prefix-matched so future minor versions (e.g. "claude-opus-4-8") resolve
 * without a code change.
 */
const MODEL_CONTEXT_LIMITS: Array<[prefix: string, maxTokens: number]> = [
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4", 200_000],
  ["claude-3-5-sonnet", 200_000],
  ["claude-3-5-haiku", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
];

function maxTokensForModel(model: string): number {
  for (const [prefix, limit] of MODEL_CONTEXT_LIMITS) {
    if (model.startsWith(prefix)) return limit;
  }
  // Conservative fallback — matches every deployed Claude model today.
  return 200_000;
}

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * Subset of OfficialQuery's API that the launcher and RPC handlers consume.
 *
 * Every method on this interface keeps the SDK's signature shape so existing
 * call sites compile unchanged. The PTY implementation either:
 *
 *   • Forwards to the live PTY (only `interrupt()`).
 *   • Returns a benign default and emits a debug log noting the visibility
 *     loss — never silently swallows.
 *
 * Adding more methods here means we accept another visibility hole in PTY
 * mode; prefer cold restart for behaviour changes whenever possible.
 */
export interface ClaudePtyController {
  /** Send SIGINT-equivalent to the PTY (Ctrl-C). */
  interrupt(): Promise<void>;
  /** Stop a specific subagent task — TUI has no equivalent; warn + no-op. */
  stopTask(taskId?: string): Promise<{ stopped: boolean }>;
  /** Inspect background tasks — TUI has no equivalent; returns empty list. */
  backgroundTasks(toolUseId?: string): Promise<{
    tasks: Array<{ id: string; status: string }>;
  }>;
  /** Hot-swap model — TUI has no equivalent; warn + no-op. Cold restart instead. */
  setModel(model: string): Promise<void>;
  /** Hot-swap permission mode — TUI has no equivalent; warn + no-op. Cold restart instead. */
  setPermissionMode(mode: string): Promise<void>;
  /**
   * Hot-swap MCP servers — TUI has no equivalent; returns an empty diff so
   * callers that diff/render the result keep working.
   */
  setMcpServers(servers: Record<string, unknown>): Promise<{
    added: string[];
    removed: string[];
    errors: Record<string, string>;
  }>;
  /** Apply settings patch — TUI has no equivalent; warn + no-op. */
  applyFlagSettings(settings: unknown): Promise<void>;
  /** Pre-warm read-state cache — TUI has no equivalent; warn + no-op. */
  seedReadState(path: string, mtime: number): Promise<void>;
  /** Initialization result — returns empty model list. */
  initializationResult(): Promise<{
    claude_code_version?: string;
    models?: Array<{
      value: string;
      displayName?: string;
      description?: string | null;
      supportsEffort?: boolean | null;
      supportedEffortLevels?: string[] | null;
      supportsAdaptiveThinking?: boolean | null;
    }>;
  }>;
  /**
   * Read a file via the active query — sidebar uses this for the "view file"
   * action. TUI has no equivalent and we deliberately do NOT shell out to
   * `fs.readFile` here: the SDK applied an allow-list at the tool-permission
   * layer that PTY mode cannot reproduce, and the path blacklist in
   * claudeControlHandlers.ts is defense-in-depth, not a sandbox. Returning
   * null causes the handler to surface `permission_denied` to the App.
   */
  readFile(
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<{
    contents: string;
    absPath: string;
    truncated: boolean;
  } | null>;
  /** List MCP server statuses — TUI has no equivalent; returns empty array. */
  mcpServerStatus(): Promise<Array<{
    name: string;
    status: "failed" | "pending" | "connected" | "disabled" | "needs-auth";
    serverInfo?: { name: string; version: string };
    error?: string;
    scope?: string;
    tools?: Array<{ name: string; description?: string }>;
  }>>;
  /** Reconnect a single MCP server — TUI has no equivalent; warn + no-op. */
  reconnectMcpServer(serverName: string): Promise<void>;
  /** Toggle a single MCP server — TUI has no equivalent; warn + no-op. */
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  /**
   * Context window usage breakdown.
   *
   * In PTY mode this is reconstructed from the latest `assistant` message's
   * usage fields (see module doc comment). Returns null before the first
   * assistant turn completes (no snapshot yet).
   */
  getContextUsage(): Promise<{
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model: string;
    categories: Array<{ name: string; tokens: number; color: string; isDeferred?: boolean }>;
    memoryFiles?: Array<{ path: string; type: string; tokens: number }>;
    mcpTools?: Array<{
      name: string;
      serverName: string;
      tokens: number;
      isLoaded: boolean;
    }>;
    systemPromptSections?: Array<{ name: string; tokens: number }>;
    messageBreakdown?: {
      toolCallTokens: number;
      toolResultTokens: number;
      attachmentTokens: number;
      assistantMessageTokens: number;
      userMessageTokens: number;
      redirectedContextTokens: number;
      unattributedTokens: number;
      toolCallsByType?: Array<{ name: string; callTokens: number; resultTokens: number }>;
      attachmentsByType?: Array<{ name: string; tokens: number }>;
    };
    apiUsage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  } | null>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a PTY-backed controller stub.
 *
 * @param pty            Live PTY handle — only `interrupt()` uses it.
 * @param getLatestUsage Optional getter for the latest assistant-message usage
 *                       snapshot. Provided by `claudeRemote.ts` which updates
 *                       a shared reference as the session scanner emits
 *                       assistant messages. Defaults to `() => null` (no data).
 * @param getMcpServers  Optional getter for the MCP server config map that was
 *                       passed to `claudeRemote()` at session start. Used by
 *                       `mcpServerStatus()` to surface configured servers to the
 *                       App even though the PTY has no programmatic status API.
 *                       Defaults to `() => ({})` (empty — no servers reported).
 */
export function createClaudePtyController(
  pty: ClaudePtyHandle,
  getLatestUsage: () => UsageSnapshot | null = () => null,
  getMcpServers: () => Record<string, unknown> = () => ({}),
): ClaudePtyController {
  return {
    async interrupt() {
      logger.debug("[ptyController] interrupt → Ctrl-C");
      pty.interrupt();
    },

    async stopTask(taskId?: string) {
      logger.debug(`[ptyController] stopTask(${taskId}) — no TUI equivalent`);
      return { stopped: false };
    },

    async backgroundTasks(toolUseId?: string) {
      logger.debug(
        `[ptyController] backgroundTasks(${toolUseId ?? "all"}) — no TUI equivalent`,
      );
      return { tasks: [] };
    },

    async setModel(model: string) {
      logger.debug(
        `[ptyController] setModel(${model}) — TUI requires cold restart`,
      );
    },

    async setPermissionMode(mode: string) {
      logger.debug(
        `[ptyController] setPermissionMode(${mode}) — TUI requires cold restart`,
      );
    },

    async setMcpServers(servers: Record<string, unknown>) {
      logger.debug(
        `[ptyController] setMcpServers(${Object.keys(servers).join(",")}) — TUI requires cold restart`,
      );
      return { added: [], removed: [], errors: {} };
    },

    async applyFlagSettings(settings: unknown) {
      // Intentionally drop — caller logs the diff already.
      void settings;
    },

    async seedReadState(path: string, mtime: number) {
      logger.debug(
        `[ptyController] seedReadState(${path}, ${mtime}) — no TUI equivalent`,
      );
    },

    async initializationResult() {
      // No equivalent in TUI mode — return empty so the launcher emits
      // an empty models[] update instead of waiting forever.
      return { models: [] };
    },

    async readFile(path: string, opts?: { maxBytes?: number }) {
      logger.debug(
        `[ptyController] readFile(${path}, maxBytes=${opts?.maxBytes ?? "?"}) — no TUI equivalent`,
      );
      return null;
    },

    async mcpServerStatus() {
      const servers = getMcpServers();
      const entries = Object.entries(servers);

      if (entries.length === 0) {
        logger.debug("[ptyController] mcpServerStatus() — no servers configured");
        return [];
      }

      const result = entries.map(([name, config]) => {
        const cfg = (config ?? {}) as Record<string, unknown>;
        const isDisabled = cfg.disabled === true;
        const isHappyManaged = HAPPY_MANAGED_SERVERS.has(name);

        const status: "connected" | "pending" | "disabled" = isDisabled
          ? "disabled"
          : isHappyManaged
            ? "connected"
            : "pending";

        logger.debug(`[ptyController] mcpServerStatus ${name}=${status}`);
        return { name, status };
      });

      return result;
    },

    async reconnectMcpServer(serverName: string) {
      logger.debug(
        `[ptyController] reconnectMcpServer(${serverName}) — no TUI equivalent`,
      );
    },

    async toggleMcpServer(serverName: string, enabled: boolean) {
      logger.debug(
        `[ptyController] toggleMcpServer(${serverName}, ${enabled}) — no TUI equivalent`,
      );
    },

    async getContextUsage() {
      const snapshot = getLatestUsage();
      if (!snapshot) return null;

      const {
        model,
        inputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        outputTokens,
      } = snapshot;

      // Total input tokens = all three input buckets (never includes output).
      const totalTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
      const maxTokens = maxTokensForModel(model);
      const percentage = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;

      logger.debug(
        `[ptyController] getContextUsage: model=${model} total=${totalTokens}/${maxTokens} (${percentage.toFixed(1)}%)`,
      );

      return {
        totalTokens,
        maxTokens,
        percentage,
        model,
        // Single bucket — no SDK-level breakdown available in PTY mode.
        categories: [
          {
            name: "Conversation",
            tokens: totalTokens,
            color: "#007AFF",
            isDeferred: false,
          },
        ],
        apiUsage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cache_read_input_tokens: cacheReadInputTokens,
        },
      };
    },
  };
}
