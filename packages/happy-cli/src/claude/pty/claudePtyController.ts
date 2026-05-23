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
 */

import type { ClaudePtyHandle } from "./claudePtyRuntime";
import { logger } from "@/ui/logger";

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
  /** Context usage — TUI has no equivalent; returns null. */
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

export function createClaudePtyController(
  pty: ClaudePtyHandle,
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
      logger.debug("[ptyController] mcpServerStatus() — no TUI equivalent");
      return [];
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
      return null;
    },
  };
}
