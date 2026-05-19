/**
 * Claude Control RPC handlers — CLI-side implementations for the sidebar
 * APIs exposed to Happy App (SDK 0.2.119+, extended in 0.3.142+).
 *
 * Schemas are defined in @kmmao/happy-wire/claudeControlRpc.ts. This file
 * implements each method on top of the Claude SDK (`Query`) and host
 * filesystem, with the tier-based security gating described in
 * docs/encryption.md.
 *
 * All params and responses travel through RpcHandlerManager which already
 * applies E2E encryption — we do not add another encryption layer here.
 *
 * Stage 3A (plaintext-content tier):
 *   - get_session_cost: aggregates cost from SDKResultMessage stream
 *   - get_binary_version: queries SDK initializationResult()
 *   - set_color: stores session accent color in local session state (App also
 *     mirrors it; no long-term persistence here — App is the source of truth)
 *
 * Stage 3B (E2E content tier):
 *   - read_file: SDK's Query.readFile() with CLI-side path blacklist
 *
 * Stage 3C (permission-gated):
 *   - mcp_call: CLI-side MCP server whitelist gating. The App MUST display a
 *     2-step confirmation and echo the token back via clientConfirmToken.
 *     CLI logs each call for audit. Default deny until an explicit whitelist
 *     is provided.
 */

import { join, isAbsolute, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type {
  Query as OfficialQuery,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  listSessions as sdkListSessions,
  getSessionInfo as sdkGetSessionInfo,
  deleteSession as sdkDeleteSession,
  renameSession as sdkRenameSession,
  getSessionMessages as sdkGetSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import type { RpcHandlerManager } from "@/api/rpc/RpcHandlerManager";
import { logger } from "@/ui/logger";
import {
  applyFlagSettings as applyFlagSettingsCore,
  type AppliedSettingsState,
} from "@/claude/utils/applyFlagSettings";
import {
  applyMcpServers,
  addMcpServer,
  removeMcpServer,
  type McpServerState,
} from "@/claude/utils/mcpServerManager";
import {
  CLAUDE_CONTROL_SCOPE,
  type GetSessionCostRequest,
  type GetSessionCostResponse,
  type GetBinaryVersionRequest,
  type GetBinaryVersionResponse,
  type SetColorRequest,
  type SetColorResponse,
  type ReadFileRequest,
  type ReadFileResponse,
  type McpCallRequest,
  type McpCallResponse,
  type GetContextUsageRequest,
  type GetContextUsageResponse,
  type GetMcpServersRequest,
  type GetMcpServersResponse,
  type SetMcpServersRequest,
  type SetMcpServersResponse,
  type ReconnectMcpServerRequest,
  type ReconnectMcpServerResponse,
  type ToggleMcpServerRequest,
  type ToggleMcpServerResponse,
  type AddMcpServerRequest,
  type AddMcpServerResponse,
  type RemoveMcpServerRequest,
  type RemoveMcpServerResponse,
  type ApplySettingsRequest,
  type ApplySettingsResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type GetSessionInfoRequest,
  type GetSessionInfoResponse,
  type DeleteSessionRequest,
  type DeleteSessionResponse,
  type RenameSessionRequest,
  type RenameSessionResponse,
  type GetSessionMessagesRequest,
  type GetSessionMessagesResponse,
} from "@kmmao/happy-wire";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * CLI-side path blacklist. Any read_file request that resolves under these
 * prefixes returns deniedReason: 'blacklisted_path'.
 * This is a defense-in-depth guard on top of the SDK's Read-tool permission
 * rules; operators may widen/narrow this via the env var
 * `HAPPY_SIDEBAR_PATH_BLACKLIST` (colon-separated absolute paths).
 */
const DEFAULT_PATH_BLACKLIST: readonly string[] = [
  join(homedir(), ".ssh"),
  join(homedir(), ".aws"),
  join(homedir(), ".config", "gcloud"),
  join(homedir(), ".happy"),
  join(homedir(), ".happy-dev"),
  join(homedir(), ".gnupg"),
  join(homedir(), ".password-store"),
  "/etc/shadow",
  "/etc/sudoers",
];

function getPathBlacklist(): readonly string[] {
  const override = process.env.HAPPY_SIDEBAR_PATH_BLACKLIST;
  if (override) {
    const paths = override.split(":").map((p) => p.trim()).filter(Boolean);
    return [...DEFAULT_PATH_BLACKLIST, ...paths];
  }
  return DEFAULT_PATH_BLACKLIST;
}

function isBlacklistedPath(absPath: string): boolean {
  const blacklist = getPathBlacklist();
  const normalized = resolvePath(absPath);
  return blacklist.some(
    (blocked) =>
      normalized === blocked || normalized.startsWith(blocked + "/"),
  );
}

/**
 * MCP-server whitelist for mcp_call. Default empty — any mcp_call returns
 * `not_whitelisted` until the operator opts in via the env var
 * `HAPPY_SIDEBAR_MCP_WHITELIST` (comma-separated MCP server names).
 */
function getMcpServerWhitelist(): readonly string[] {
  const raw = process.env.HAPPY_SIDEBAR_MCP_WHITELIST;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseMcpToolName(
  tool: string,
): { server: string; toolName: string } | null {
  const match = tool.match(/^mcp__([a-z0-9_-]+)__([a-z0-9_.-]+)$/i);
  if (!match) return null;
  return { server: match[1], toolName: match[2] };
}

// ─── Session-cost aggregator ────────────────────────────────────────────────

export class SessionCostTracker {
  private totalUsd = 0;
  private byModel = new Map<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      costUsd: number;
    }
  >();

  /**
   * Fold an SDKResultMessage-shaped record into the running tally. Callers
   * should invoke this on every SDK result turn; unknown shapes are ignored
   * and never throw.
   */
  record(entry: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    total_cost_usd?: number;
  }): void {
    try {
      if (typeof entry.total_cost_usd === "number") {
        this.totalUsd += entry.total_cost_usd;
      }
      const model = entry.model ?? "unknown";
      const u = entry.usage ?? {};
      const existing = this.byModel.get(model) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0,
      };
      existing.inputTokens += u.input_tokens ?? 0;
      existing.outputTokens += u.output_tokens ?? 0;
      existing.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
      existing.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
      existing.costUsd += entry.total_cost_usd ?? 0;
      this.byModel.set(model, existing);
    } catch (e) {
      logger.debug("[claudeControl] SessionCostTracker.record failed", e);
    }
  }

  /**
   * Fold an `SDKResultMessage` (either success or error subtype) into the
   * running tally. Prefers the per-model `modelUsage` breakdown when
   * present, falling back to the aggregate `usage` + `total_cost_usd` pair
   * when the SDK did not report per-model data.
   *
   * Both branches accumulate additively; never subtract. Call once per
   * result message the launcher sees.
   */
  recordResult(msg: SDKResultMessage): void {
    try {
      const modelUsage = msg.modelUsage;
      const perModelKeys = modelUsage ? Object.keys(modelUsage) : [];
      if (perModelKeys.length > 0 && modelUsage) {
        for (const modelName of perModelKeys) {
          const mu = modelUsage[modelName];
          if (!mu) continue;
          this.record({
            model: modelName,
            usage: {
              input_tokens: mu.inputTokens,
              output_tokens: mu.outputTokens,
              cache_creation_input_tokens: mu.cacheCreationInputTokens,
              cache_read_input_tokens: mu.cacheReadInputTokens,
            },
            total_cost_usd: mu.costUSD,
          });
        }
        return;
      }
      // Aggregate fallback — no per-model breakdown available.
      this.record({
        usage: {
          input_tokens: msg.usage?.input_tokens ?? 0,
          output_tokens: msg.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: msg.usage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: msg.usage?.cache_read_input_tokens ?? 0,
        },
        total_cost_usd: msg.total_cost_usd,
      });
    } catch (e) {
      logger.debug("[claudeControl] SessionCostTracker.recordResult failed", e);
    }
  }

  snapshot(): GetSessionCostResponse {
    const byModel: GetSessionCostResponse["byModel"] = {};
    for (const [k, v] of this.byModel) byModel[k] = { ...v };
    return {
      formatted: `Total: $${this.totalUsd.toFixed(4)}`,
      totalUsd: this.totalUsd,
      byModel,
    };
  }
}

// ─── Registration ───────────────────────────────────────────────────────────

export interface RegisterClaudeControlHandlersOptions {
  rpcHandlerManager: RpcHandlerManager;
  /** Returns the currently-active Claude Query, or null when idle. */
  getCurrentQuery: () => OfficialQuery | null;
  /** Session working directory used for resolving read_file relative paths. */
  cwd: string;
  /** Session-scoped cost tracker; null when the launcher does not wire one. */
  costTracker?: SessionCostTracker | null;
  /** happy-cli package version; surfaced by get_binary_version. */
  happyCliVersion?: string;
  /** Shared applied-settings state tracker for applyFlagSettings introspection. */
  appliedSettingsState?: AppliedSettingsState | null;
  /** Shared MCP server state tracker for dynamic load/unload. */
  mcpServerState?: McpServerState | null;
}

/**
 * Register the 6 claude-control:* RPC handlers on the given manager. Called
 * once per session from claudeRemoteLauncher.
 */
export function registerClaudeControlHandlers(
  opts: RegisterClaudeControlHandlersOptions,
): void {
  const { rpcHandlerManager, getCurrentQuery, cwd, costTracker, happyCliVersion, appliedSettingsState, mcpServerState } = opts;
  const scope = CLAUDE_CONTROL_SCOPE;

  // get_session_cost
  rpcHandlerManager.registerHandler<GetSessionCostRequest, GetSessionCostResponse>(
    `${scope}:get_session_cost`,
    async () => {
      if (!costTracker) {
        return { formatted: "$0.0000", totalUsd: 0 };
      }
      return costTracker.snapshot();
    },
  );

  // get_binary_version
  rpcHandlerManager.registerHandler<GetBinaryVersionRequest, GetBinaryVersionResponse>(
    `${scope}:get_binary_version`,
    async () => {
      const q = getCurrentQuery();
      if (!q) {
        return {
          version: "unknown",
          happyCliVersion,
        };
      }
      try {
        const init = await q.initializationResult();
        return {
          version:
            (init as unknown as { claude_code_version?: string })
              .claude_code_version ?? "unknown",
          happyCliVersion,
        };
      } catch (e) {
        logger.debug("[claudeControl] get_binary_version: initializationResult failed", e);
        return { version: "unknown", happyCliVersion };
      }
    },
  );

  // set_color — stored as ephemeral ack; App is source of truth for persistence.
  rpcHandlerManager.registerHandler<SetColorRequest, SetColorResponse>(
    `${scope}:set_color`,
    async (req) => {
      logger.debug(`[claudeControl] set_color color=${req.color}`);
      return { success: true, color: req.color };
    },
  );

  // read_file
  rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>(
    `${scope}:read_file`,
    async (req) => {
      const absPath = isAbsolute(req.path) ? req.path : resolvePath(cwd, req.path);
      if (isBlacklistedPath(absPath)) {
        logger.debug(`[claudeControl] read_file BLOCKED by blacklist: ${absPath}`);
        return { result: null, deniedReason: "blacklisted_path" };
      }
      const q = getCurrentQuery();
      if (!q) {
        return { result: null, deniedReason: "error" };
      }
      try {
        const sdkResult = await q.readFile(req.path, {
          maxBytes: req.maxBytes ?? 1024 * 1024,
        });
        if (!sdkResult) {
          return { result: null, deniedReason: "permission_denied" };
        }
        return {
          result: {
            contents: sdkResult.contents,
            absPath: sdkResult.absPath,
            truncated: sdkResult.truncated,
          },
        };
      } catch (e) {
        logger.debug("[claudeControl] read_file failed", e);
        return { result: null, deniedReason: "error" };
      }
    },
  );

  // mcp_call — default-deny unless whitelisted
  rpcHandlerManager.registerHandler<McpCallRequest, McpCallResponse>(
    `${scope}:mcp_call`,
    async (req) => {
      const parsed = parseMcpToolName(req.tool);
      if (!parsed) {
        return {
          success: false,
          errorCode: "invalid_arguments",
          errorMessage: `Invalid MCP tool name: ${req.tool}`,
        };
      }
      const whitelist = getMcpServerWhitelist();
      if (!whitelist.includes(parsed.server)) {
        logger.debug(
          `[claudeControl] mcp_call BLOCKED — server not in whitelist: ${parsed.server} (set HAPPY_SIDEBAR_MCP_WHITELIST to opt in)`,
        );
        return {
          success: false,
          errorCode: "not_whitelisted",
          errorMessage: `MCP server '${parsed.server}' is not whitelisted on this CLI.`,
        };
      }
      if (!req.clientConfirmToken) {
        return {
          success: false,
          errorCode: "permission_denied",
          errorMessage: "Missing client confirmation token — App must show a 2-step confirm dialog.",
        };
      }
      // Audit log — security-critical. Records server + tool + first bytes of confirm token.
      logger.debug(
        `[claudeControl] [AUDIT] mcp_call server=${parsed.server} tool=${parsed.toolName} confirmToken=${req.clientConfirmToken.slice(0, 8)}...`,
      );
      // Upstream SDK gap: `@anthropic-ai/claude-agent-sdk@0.2.119` ships the
      // `SDKControlMcpCallRequest` protocol type in sdk.d.ts but exposes no
      // corresponding runtime method on the `Query` interface — the existing
      // `mcpServerStatus()` / `setMcpServers()` / `reconnectMcpServer()` /
      // `toggleMcpServer()` members only configure and report on servers,
      // none invokes a tool. Until the SDK lands a public `callMcpTool()`
      // (or equivalent), we return `sdk_not_implemented` so the App can
      // surface an honest "waiting on SDK" state instead of masking the gap
      // as a transient server error.
      //
      // Rolling our own MCP client (spawning a parallel
      // `@modelcontextprotocol/sdk` connection per whitelisted server) is
      // possible but duplicates the SDK's managed lifecycle and cannot cover
      // `type: 'sdk'` servers — not worth the maintenance cost for a gap
      // that should be closed upstream.
      return {
        success: false,
        errorCode: "sdk_not_implemented",
        errorMessage:
          "Claude Agent SDK 0.2.119 does not expose a public runtime method for mcp_call (protocol type is declared but unimplemented). Waiting on upstream; whitelist and confirm token were accepted.",
      };
    },
  );

  // get_context_usage — context window breakdown via SDK getContextUsage()
  rpcHandlerManager.registerHandler<GetContextUsageRequest, GetContextUsageResponse>(
    `${scope}:get_context_usage`,
    async () => {
      const q = getCurrentQuery();
      if (!q) {
        return {
          categories: [],
          totalTokens: 0,
          maxTokens: 1000000,
          percentage: 0,
          model: "unknown",
          memoryFiles: [],
          mcpTools: [],
        };
      }
      try {
        const raw = await q.getContextUsage();
        logger.debug("[claudeControl] get_context_usage raw", JSON.stringify({
          categoryNames: raw.categories.map((c) => `${c.name}:${c.tokens}`),
          totalTokens: raw.totalTokens,
          maxTokens: raw.maxTokens,
          systemPromptSections: raw.systemPromptSections,
          memoryFilesCount: raw.memoryFiles?.length,
          mcpToolsCount: raw.mcpTools?.length,
          messageBreakdown: raw.messageBreakdown ? {
            user: raw.messageBreakdown.userMessageTokens,
            assistant: raw.messageBreakdown.assistantMessageTokens,
            toolCall: raw.messageBreakdown.toolCallTokens,
            toolResult: raw.messageBreakdown.toolResultTokens,
            attachment: raw.messageBreakdown.attachmentTokens,
            redirected: raw.messageBreakdown.redirectedContextTokens,
            unattributed: raw.messageBreakdown.unattributedTokens,
          } : "none",
        }));
        return {
          categories: raw.categories.map((c) => ({
            name: c.name,
            tokens: c.tokens,
            color: c.color,
            isDeferred: c.isDeferred,
          })),
          totalTokens: raw.totalTokens,
          maxTokens: raw.maxTokens,
          percentage: raw.percentage,
          model: raw.model,
          memoryFiles: (raw.memoryFiles ?? []).map((f) => ({
            path: f.path,
            type: f.type,
            tokens: f.tokens,
          })),
          mcpTools: (raw.mcpTools ?? []).map((t) => ({
            name: t.name,
            serverName: t.serverName,
            tokens: t.tokens,
            isLoaded: t.isLoaded,
          })),
          messageBreakdown: raw.messageBreakdown
            ? {
                toolCallTokens: raw.messageBreakdown.toolCallTokens,
                toolResultTokens: raw.messageBreakdown.toolResultTokens,
                attachmentTokens: raw.messageBreakdown.attachmentTokens,
                assistantMessageTokens: raw.messageBreakdown.assistantMessageTokens,
                userMessageTokens: raw.messageBreakdown.userMessageTokens,
                redirectedContextTokens: raw.messageBreakdown.redirectedContextTokens,
                unattributedTokens: raw.messageBreakdown.unattributedTokens,
                toolCallsByType: (raw.messageBreakdown.toolCallsByType ?? []).map((t) => ({
                  name: t.name,
                  callTokens: t.callTokens,
                  resultTokens: t.resultTokens,
                })),
                attachmentsByType: (raw.messageBreakdown.attachmentsByType ?? []).map((a) => ({
                  name: a.name,
                  tokens: a.tokens,
                })),
              }
            : undefined,
          systemPromptSections: raw.systemPromptSections?.map((s) => ({
            name: s.name,
            tokens: s.tokens,
          })),
          apiUsage: raw.apiUsage
            ? {
                inputTokens: raw.apiUsage.input_tokens,
                outputTokens: raw.apiUsage.output_tokens,
                cacheCreationInputTokens: raw.apiUsage.cache_creation_input_tokens,
                cacheReadInputTokens: raw.apiUsage.cache_read_input_tokens,
              }
            : undefined,
        };
      } catch (e) {
        logger.debug("[claudeControl] get_context_usage failed", e);
        return {
          categories: [],
          totalTokens: 0,
          maxTokens: 1000000,
          percentage: 0,
          model: "unknown",
          memoryFiles: [],
          mcpTools: [],
        };
      }
    },
  );

  // get_mcp_servers — list active MCP server connections + tool inventory
  rpcHandlerManager.registerHandler<GetMcpServersRequest, GetMcpServersResponse>(
    `${scope}:get_mcp_servers`,
    async () => {
      const q = getCurrentQuery();
      if (!q) {
        return { servers: [] };
      }
      try {
        const statuses = await q.mcpServerStatus();
        return {
          servers: statuses.map((s) => ({
            name: s.name,
            status: s.status,
            serverInfo: s.serverInfo,
            error: s.error,
            scope: s.scope,
            toolCount: s.tools?.length,
            tools: s.tools?.map((tool) => ({
              name: tool.name,
              description: tool.description,
            })),
          })),
        };
      } catch (e) {
        logger.debug("[claudeControl] get_mcp_servers failed", e);
        return { servers: [] };
      }
    },
  );

  // set_mcp_servers — hot-swap MCP server config on a running session (SDK 0.3.142+)
  rpcHandlerManager.registerHandler<SetMcpServersRequest, SetMcpServersResponse>(
    `${scope}:set_mcp_servers`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        return { added: [], removed: [], errors: { _: "No active query" } };
      }
      if (!mcpServerState) {
        return { added: [], removed: [], errors: { _: "No MCP server state — launcher did not wire one" } };
      }
      const result = await applyMcpServers(
        q,
        req.servers as Record<string, Record<string, unknown>>,
        mcpServerState,
      );
      if (!result.ok) {
        return { added: [], removed: [], errors: { _: result.error } };
      }
      return {
        added: result.added,
        removed: result.removed,
        errors: result.errors,
      };
    },
  );

  // reconnect_mcp_server — reconnect a single server by name (SDK 0.3.142+)
  rpcHandlerManager.registerHandler<ReconnectMcpServerRequest, ReconnectMcpServerResponse>(
    `${scope}:reconnect_mcp_server`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        throw new Error("No active query — cannot reconnect MCP server");
      }
      await q.reconnectMcpServer(req.serverName);
      logger.debug(`[claudeControl] reconnect_mcp_server server=${req.serverName}`);
      return { success: true };
    },
  );

  // toggle_mcp_server — enable/disable a server without removing config (SDK 0.3.142+)
  rpcHandlerManager.registerHandler<ToggleMcpServerRequest, ToggleMcpServerResponse>(
    `${scope}:toggle_mcp_server`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        throw new Error("No active query — cannot toggle MCP server");
      }
      await q.toggleMcpServer(req.serverName, req.enabled);
      logger.debug(`[claudeControl] toggle_mcp_server server=${req.serverName} enabled=${req.enabled}`);
      return { success: true };
    },
  );

  // add_mcp_server — dynamically register a single MCP server on a running session
  rpcHandlerManager.registerHandler<AddMcpServerRequest, AddMcpServerResponse>(
    `${scope}:add_mcp_server`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        return { success: false, added: [], errors: {}, errorMessage: "No active query" };
      }
      if (!mcpServerState) {
        return { success: false, added: [], errors: {}, errorMessage: "No MCP server state" };
      }
      const result = await addMcpServer(
        q,
        req.name,
        req.config as Record<string, unknown>,
        mcpServerState,
      );
      if (!result.ok) {
        return { success: false, added: [], errors: {}, errorMessage: result.error };
      }
      return {
        success: true,
        added: result.added,
        errors: result.errors,
      };
    },
  );

  // remove_mcp_server — dynamically unregister a single MCP server from a running session
  rpcHandlerManager.registerHandler<RemoveMcpServerRequest, RemoveMcpServerResponse>(
    `${scope}:remove_mcp_server`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        return { success: false, removed: [], errorMessage: "No active query" };
      }
      if (!mcpServerState) {
        return { success: false, removed: [], errorMessage: "No MCP server state" };
      }
      const result = await removeMcpServer(q, req.name, mcpServerState);
      if (!result.ok) {
        return { success: false, removed: [], errorMessage: result.error };
      }
      return {
        success: true,
        removed: result.removed,
      };
    },
  );

  // apply_settings — hot-swap Settings-layer fields via applyFlagSettings() (SDK 0.3.142+)
  rpcHandlerManager.registerHandler<ApplySettingsRequest, ApplySettingsResponse>(
    `${scope}:apply_settings`,
    async (req) => {
      const q = getCurrentQuery();
      if (!q) {
        throw new Error("No active query — cannot apply settings");
      }
      if (!appliedSettingsState) {
        throw new Error("No applied-settings state — launcher did not wire one");
      }
      const result = await applyFlagSettingsCore(
        q,
        req.settings as Record<string, unknown>,
        appliedSettingsState,
      );
      if (!result.applied && result.reason === "validation_error") {
        throw new Error(`apply_settings validation failed: ${result.error}`);
      }
      if (!result.applied && result.reason === "sdk_error") {
        throw new Error(`apply_settings SDK error: ${result.error}`);
      }
      return { success: true };
    },
  );

  // ─── Session Management (SDK 0.3.143+ standalone exports) ─────────────────
  // These do NOT require an active Query — they operate on the local session
  // JSONL storage directly via SDK standalone functions.

  // list_sessions — enumerate sessions on the remote machine
  rpcHandlerManager.registerHandler<ListSessionsRequest, ListSessionsResponse>(
    `${scope}:list_sessions`,
    async (req) => {
      try {
        const sessions = await sdkListSessions({
          dir: req.dir,
          limit: req.limit,
          offset: req.offset,
        });
        return {
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            summary: s.summary,
            lastModified: s.lastModified,
            fileSize: s.fileSize,
            customTitle: s.customTitle,
            firstPrompt: s.firstPrompt,
            gitBranch: s.gitBranch,
            cwd: s.cwd,
            tag: s.tag,
            createdAt: s.createdAt,
          })),
        };
      } catch (e) {
        logger.debug("[claudeControl] list_sessions failed", e);
        return { sessions: [] };
      }
    },
  );

  // get_session_info — get info about a specific session
  rpcHandlerManager.registerHandler<GetSessionInfoRequest, GetSessionInfoResponse>(
    `${scope}:get_session_info`,
    async (req) => {
      try {
        const info = await sdkGetSessionInfo(req.targetSessionId, {
          dir: req.dir,
        });
        if (!info) return { session: null };
        return {
          session: {
            sessionId: info.sessionId,
            summary: info.summary,
            lastModified: info.lastModified,
            fileSize: info.fileSize,
            customTitle: info.customTitle,
            firstPrompt: info.firstPrompt,
            gitBranch: info.gitBranch,
            cwd: info.cwd,
            tag: info.tag,
            createdAt: info.createdAt,
          },
        };
      } catch (e) {
        logger.debug("[claudeControl] get_session_info failed", e);
        return { session: null };
      }
    },
  );

  // delete_session — remove a session's JSONL file
  rpcHandlerManager.registerHandler<DeleteSessionRequest, DeleteSessionResponse>(
    `${scope}:delete_session`,
    async (req) => {
      logger.debug(`[claudeControl] delete_session id=${req.targetSessionId}`);
      await sdkDeleteSession(req.targetSessionId, { dir: req.dir });
      return { success: true };
    },
  );

  // rename_session — set a custom title on a session
  rpcHandlerManager.registerHandler<RenameSessionRequest, RenameSessionResponse>(
    `${scope}:rename_session`,
    async (req) => {
      logger.debug(`[claudeControl] rename_session id=${req.targetSessionId} title=${req.title}`);
      await sdkRenameSession(req.targetSessionId, req.title, { dir: req.dir });
      return { success: true };
    },
  );

  // get_session_messages — read messages from a session's JSONL
  rpcHandlerManager.registerHandler<GetSessionMessagesRequest, GetSessionMessagesResponse>(
    `${scope}:get_session_messages`,
    async (req) => {
      try {
        const msgs = await sdkGetSessionMessages(req.targetSessionId, {
          dir: req.dir,
          limit: req.limit,
          offset: req.offset,
          includeSystemMessages: req.includeSystemMessages,
        });
        return {
          messages: msgs.map((m) => ({
            type: m.type,
            uuid: m.uuid,
            sessionId: m.session_id,
            content: m.message,
          })),
          totalCount: msgs.length,
        };
      } catch (e) {
        logger.debug("[claudeControl] get_session_messages failed", e);
        return { messages: [], totalCount: 0 };
      }
    },
  );

  logger.debug("[claudeControl] Registered 19 claude-control:* RPC handlers");
}
