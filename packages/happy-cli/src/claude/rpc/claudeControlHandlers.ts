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
 *   - file_suggestions: fs walk-based fuzzy match under cwd, blacklist-aware
 *
 * Stage 3C (permission-gated):
 *   - mcp_call: CLI-side MCP server whitelist gating. The App MUST display a
 *     2-step confirmation and echo the token back via clientConfirmToken.
 *     CLI logs each call for audit. Default deny until an explicit whitelist
 *     is provided.
 */

import { readdir } from "node:fs/promises";
import { join, relative, isAbsolute, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { Query as OfficialQuery } from "@anthropic-ai/claude-agent-sdk";
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
  type FileSuggestionsRequest,
  type FileSuggestionsResponse,
  type McpCallRequest,
  type McpCallResponse,
} from "@kmmao/happy-wire";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * CLI-side path blacklist. Any read_file / file_suggestions request that
 * resolves under these prefixes returns deniedReason: 'blacklisted_path'.
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

// ─── File-suggestions helper ────────────────────────────────────────────────

async function collectFileSuggestions(
  cwd: string,
  query: string,
  limit: number,
): Promise<FileSuggestionsResponse["suggestions"]> {
  const needle = query.toLowerCase();
  const MAX_ENTRIES_SCANNED = 500;
  const suggestions: FileSuggestionsResponse["suggestions"] = [];
  let scanned = 0;

  async function walk(dir: string): Promise<void> {
    if (scanned >= MAX_ENTRIES_SCANNED || suggestions.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (scanned >= MAX_ENTRIES_SCANNED || suggestions.length >= limit) return;
      scanned++;
      if (e.name.startsWith(".")) continue;
      if (
        e.name === "node_modules" ||
        e.name === ".git" ||
        e.name === "dist" ||
        e.name === "build"
      ) {
        continue;
      }
      const absPath = join(dir, e.name);
      if (isBlacklistedPath(absPath)) continue;
      const rel = relative(cwd, absPath);
      if (rel.toLowerCase().includes(needle)) {
        suggestions.push({
          path: rel,
          type: e.isDirectory() ? "directory" : "file",
        });
        if (suggestions.length >= limit) return;
      }
      if (e.isDirectory()) await walk(absPath);
    }
  }

  await walk(cwd);
  return suggestions;
}

// ─── Registration ───────────────────────────────────────────────────────────

export interface RegisterClaudeControlHandlersOptions {
  rpcHandlerManager: RpcHandlerManager;
  /** Returns the currently-active Claude Query, or null when idle. */
  getCurrentQuery: () => OfficialQuery | null;
  /** Session working directory used for file_suggestions and path resolution. */
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

  // file_suggestions
  rpcHandlerManager.registerHandler<FileSuggestionsRequest, FileSuggestionsResponse>(
    `${scope}:file_suggestions`,
    async (req) => {
      const limit = req.limit ?? 20;
      if (!req.query.trim()) {
        return { suggestions: [] };
      }
      try {
        const suggestions = await collectFileSuggestions(cwd, req.query, limit);
        return { suggestions };
      } catch (e) {
        logger.debug("[claudeControl] file_suggestions failed", e);
        return { suggestions: [] };
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
      // Actual MCP invocation requires wiring into happy-cli's MCP client
      // infrastructure (see packages/happy-cli/src/codex/codexMcpClient.ts
      // for the codex pattern; Claude has its own MCP lifecycle via the SDK).
      // That integration is out of scope for the initial rollout — the
      // handler returns `server_unavailable` as a safe placeholder. Follow-up
      // work: resolve the MCP client for `parsed.server` via the SDK's
      // mcpServerStatus + setMcpServers API, then invoke the tool and map
      // the response.
      return {
        success: false,
        errorCode: "server_unavailable",
        errorMessage:
          "mcp_call integration is stubbed pending MCP client wiring; tool whitelisted and confirm token accepted.",
      };
    },
  );

  logger.debug("[claudeControl] Registered 6 claude-control:* RPC handlers");
}
