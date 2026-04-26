/**
 * Claude Control RPC handlers — CLI-side implementations for the 6 sidebar
 * APIs exposed to Happy App (SDK 0.2.119+).
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
import type { RpcHandlerManager } from "@/api/rpc/RpcHandlerManager";
import { logger } from "@/ui/logger";
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
}

/**
 * Register the 6 claude-control:* RPC handlers on the given manager. Called
 * once per session from claudeRemoteLauncher.
 */
export function registerClaudeControlHandlers(
  opts: RegisterClaudeControlHandlersOptions,
): void {
  const { rpcHandlerManager, getCurrentQuery, cwd, costTracker, happyCliVersion } = opts;
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
            (init as unknown as { claudeCodeVersion?: string })
              .claudeCodeVersion ?? "unknown",
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
          maxTokens: 200000,
          percentage: 0,
          model: "unknown",
          memoryFiles: [],
          mcpTools: [],
        };
      }
      try {
        const raw = await q.getContextUsage();
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
        };
      } catch (e) {
        logger.debug("[claudeControl] get_context_usage failed", e);
        return {
          categories: [],
          totalTokens: 0,
          maxTokens: 200000,
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

  logger.debug("[claudeControl] Registered 8 claude-control:* RPC handlers");
}
