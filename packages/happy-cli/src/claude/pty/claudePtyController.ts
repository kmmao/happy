/**
 * claudePtyController — a `Query`-shaped controller backed by a PTY.
 *
 * Why this exists
 * ---------------
 * Before the PTY migration the launcher consumed `OfficialQuery` from
 * `@anthropic-ai/claude-agent-sdk` for runtime control. Most of those
 * runtime knobs (hot-swap model / permission mode / MCP servers /
 * applyFlagSettings / stopTask / backgroundTasks / seedReadState /
 * reconnectMcpServer / toggleMcpServer) have no equivalent in the Claude
 * TUI — they were SDK-only conveniences. The migration plan accepted
 * that loss: behaviour changes are driven by the launcher's
 * `coldModeHash` cold-restart instead, and `applyFlagSettings` patches
 * happen at PTY spawn time (via `buildClaudeCliFlags` + temporary
 * settings.json) rather than at runtime.
 *
 * What remains on this controller is the subset that still has a real
 * behaviour in PTY mode:
 *
 *   • interrupt()             → write Ctrl-C (0x03) to PTY stdin
 *   • approveExitPlan()       → write "1\r" to confirm TUI plan-mode dialog
 *   • mcpServerStatus()       → snapshot the launcher-side MCP config map
 *   • getContextUsage()       → reconstruct usage from JSONL snapshot
 *   • initializationResult()  → returns empty models[] (App still polls)
 *   • readFile()              → returns null (handler maps to permission_denied)
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
 * The narrow surface the launcher and RPC handlers actually need in PTY
 * mode. Each method has a concrete behaviour — no-op shims that mirrored
 * SDK-only knobs (setModel / setPermissionMode / setMcpServers /
 * applyFlagSettings / stopTask / backgroundTasks / seedReadState /
 * reconnectMcpServer / toggleMcpServer) were removed once their callers
 * proved to be dead paths; cold restart via `coldModeHash` replaces them.
 */
export interface ClaudePtyController {
  /** Send SIGINT-equivalent to the PTY (Ctrl-C). */
  interrupt(): Promise<void>;
  /**
   * Approve the Claude TUI's ExitPlanMode confirmation dialog by writing
   * the "1\r" keystroke to PTY stdin — selecting the first option
   * ("Yes, and auto-accept edits going forward"). Required because PTY
   * mode bypasses `canCallTool`: when Claude emits an ExitPlanMode tool_use
   * the TUI renders an in-terminal Yes/No picker that no App button can
   * reach. In Yolo/bypassPermissions mode the launcher invokes this
   * automatically so plan-mode sessions don't hang indefinitely.
   *
   * NOTE: TUI's exit-plan picker has no "bypassPermissions" option — it
   * only offers auto-accept-edits (option 1) or manual approval (option 2).
   * We pick option 1 because it preserves the closest equivalent of the
   * user's intent (no further per-tool prompts) for the rest of the turn.
   */
  approveExitPlan(): Promise<void>;
  /** Initialization result — returns empty model list in PTY mode. */
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
  /** Snapshot MCP server statuses from the launcher-side config map. */
  mcpServerStatus(): Promise<Array<{
    name: string;
    status: "failed" | "pending" | "connected" | "disabled" | "needs-auth";
    serverInfo?: { name: string; version: string };
    error?: string;
    scope?: string;
    tools?: Array<{ name: string; description?: string }>;
  }>>;
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
 * @param pty            Live PTY handle — used by `interrupt()` and
 *                       `approveExitPlan()` to write control bytes / keys.
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

    async approveExitPlan() {
      // "1" + CR selects the first option ("Yes, and auto-accept edits")
      // in the TUI's plan-mode confirmation dialog. CR (\r) matches the
      // submit convention used elsewhere in the PTY layer.
      logger.debug("[ptyController] approveExitPlan → write '1\\r'");
      pty.write("1\r");
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

      // PTY mode has no live MCP feedback (no SDK Query.mcpServerStatus()
      // hook to listen to). The Claude TUI subprocess connects to MCPs at
      // launch; by the time the App polls (every 30s), they are either
      // connected or failed — and we have no signal to distinguish those.
      // We therefore optimistically report "connected" for any configured,
      // non-disabled MCP. The user still sees real connection errors
      // because Claude prints them in the terminal, and MCP-prefixed tool
      // calls will themselves fail loudly if a server is broken.
      //
      // Happy's own MCPs (happy / happy-knowledge) are guaranteed connected
      // since the launcher owns their lifecycle; they share the same code
      // path because "connected" is now the default for everything.
      const result = entries.map(([name, config]) => {
        const cfg = (config ?? {}) as Record<string, unknown>;
        const status: "connected" | "disabled" = cfg.disabled === true
          ? "disabled"
          : "connected";
        logger.debug(`[ptyController] mcpServerStatus ${name}=${status}`);
        return { name, status };
      });

      return result;
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
