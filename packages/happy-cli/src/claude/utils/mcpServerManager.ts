/**
 * mcpServerManager — dynamic MCP server lifecycle management for running
 * Claude sessions.
 *
 * Provides a safe, validated interface for the App to:
 *   - Add / remove individual MCP servers on a live session
 *   - Replace the full server set (via `setMcpServers`)
 *   - Sync servers from the account-level MCP registry
 *
 * ## Security invariants
 *
 * 1. **Protected servers** (`happy`, `happy-knowledge`) cannot be added,
 *    removed, or overwritten by App RPC calls. They are always re-injected
 *    into the config before calling the SDK.
 * 2. **Transport validation** — every config is validated before it reaches
 *    the SDK: stdio must have `command`, network transports must have `url`,
 *    and only known transport types are accepted.
 * 3. **State tracking** — `McpServerState` records the user-provided servers
 *    separately from protected servers, enabling accurate diff/sync.
 *
 * ## Relationship to SDK
 *
 * The SDK's `Query.setMcpServers()` does a full diff-and-apply: it connects
 * newly added servers and disconnects removed ones, keeping unchanged ones
 * alive. This module builds the full config map (user + protected) before
 * each `setMcpServers()` call.
 */

import type { ClaudePtyController } from "@/claude/pty/claudePtyController";
import { logger } from "@/lib";

// ─── Protected server names ───────────────────────────────────────────────────

/**
 * Server names that cannot be added/removed/overwritten by App RPCs.
 * These are Happy's own MCP servers created by the launcher.
 *
 * Exported so other modules (e.g. claudeControlHandlers.toggle_mcp_server)
 * can reject mutations to these names with a consistent error message
 * instead of redefining the set.
 */
export const PROTECTED_SERVER_NAMES = new Set(["happy", "happy-knowledge"]);

// ─── Known transport types ────────────────────────────────────────────────────

const VALID_TRANSPORT_TYPES = new Set([
  "stdio",
  "sse",
  "http",
  "streamable-http",
  "url",
]);

/** Transport types that require a `url` field. */
const URL_TRANSPORTS = new Set(["sse", "http", "streamable-http", "url"]);

// ─── State ────────────────────────────────────────────────────────────────────

export interface McpServerState {
  /** User-provided servers (from App RPC or registry sync). Keyed by name. */
  userServers: Record<string, Record<string, unknown>>;
  /** Protected servers injected by the launcher. Keyed by name. */
  protectedServers: Record<string, Record<string, unknown>>;
  /** Timestamp of the last successful setMcpServers call. */
  lastSyncAt: number | null;
}

export function createMcpServerState(): McpServerState {
  return {
    userServers: {},
    protectedServers: {},
    lastSyncAt: null,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a single MCP server config entry.
 * Checks transport type, required fields, and protected name.
 */
export function validateMcpServerConfig(
  name: string,
  config: unknown,
): ValidateResult {
  // Protected name check
  if (PROTECTED_SERVER_NAMES.has(name)) {
    return { ok: false, error: `server '${name}' is protected and cannot be modified` };
  }

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, error: `server '${name}': config must be a plain object` };
  }

  const cfg = config as Record<string, unknown>;
  const type = (cfg.type as string) ?? "stdio"; // default to stdio

  if (!VALID_TRANSPORT_TYPES.has(type)) {
    return {
      ok: false,
      error: `server '${name}': unknown transport type '${type}' (valid: ${[...VALID_TRANSPORT_TYPES].join(", ")})`,
    };
  }

  // stdio requires command
  if (type === "stdio") {
    if (typeof cfg.command !== "string" || !cfg.command) {
      return { ok: false, error: `server '${name}': stdio transport requires a 'command' string` };
    }
    // Validate args if present
    if (cfg.args !== undefined) {
      if (!Array.isArray(cfg.args)) {
        return { ok: false, error: `server '${name}': 'args' must be a string array` };
      }
      for (let i = 0; i < cfg.args.length; i++) {
        if (typeof cfg.args[i] !== "string") {
          return { ok: false, error: `server '${name}': args[${i}] must be a string` };
        }
      }
    }
    // Validate env if present
    if (cfg.env !== undefined) {
      if (cfg.env === null || typeof cfg.env !== "object" || Array.isArray(cfg.env)) {
        return { ok: false, error: `server '${name}': 'env' must be a Record<string, string>` };
      }
      for (const [k, v] of Object.entries(cfg.env as Record<string, unknown>)) {
        if (typeof v !== "string") {
          return { ok: false, error: `server '${name}': env.${k} must be a string` };
        }
      }
    }
  }

  // URL-based transports require url
  if (URL_TRANSPORTS.has(type)) {
    if (typeof cfg.url !== "string" || !cfg.url) {
      return { ok: false, error: `server '${name}': ${type} transport requires a 'url' string` };
    }
  }

  return { ok: true };
}

// ─── Results ──────────────────────────────────────────────────────────────────

export type McpApplyResult =
  | { ok: true; added: string[]; removed: string[]; errors: Record<string, string> }
  | { ok: false; error: string };

// ─── Core: apply full server set ──────────────────────────────────────────────

/**
 * Replace the full set of user MCP servers. Protected servers are always
 * re-injected. Validates all configs before calling the SDK.
 *
 * @param query - Active SDK Query
 * @param servers - User-provided server configs (excluding protected names)
 * @param state - Mutable state tracker
 */
export async function applyMcpServers(
  query: ClaudePtyController,
  servers: Record<string, Record<string, unknown>>,
  state: McpServerState,
): Promise<McpApplyResult> {
  // Validate all configs
  for (const [name, config] of Object.entries(servers)) {
    const v = validateMcpServerConfig(name, config);
    if (!v.ok) {
      logger.debug(`[mcpServerManager] Validation failed: ${v.error}`);
      return { ok: false, error: v.error };
    }
  }

  // Build full config: protected + user
  const fullConfig = {
    ...state.protectedServers,
    ...servers,
  };

  try {
    const result = await query.setMcpServers(fullConfig as any);

    // Track state
    state.userServers = { ...servers };
    state.lastSyncAt = Date.now();

    logger.debug(
      `[mcpServerManager] Applied: added=${result.added.join(",") || "none"} removed=${result.removed.join(",") || "none"} errors=${JSON.stringify(result.errors)}`,
    );

    return {
      ok: true,
      added: result.added,
      removed: result.removed,
      errors: result.errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[mcpServerManager] claude setMcpServers failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ─── Add single server ───────────────────────────────────────────────────────

/**
 * Add a single MCP server to the running session. Merges with existing
 * user servers and re-applies the full set.
 */
export async function addMcpServer(
  query: ClaudePtyController,
  name: string,
  config: Record<string, unknown>,
  state: McpServerState,
): Promise<McpApplyResult> {
  const v = validateMcpServerConfig(name, config);
  if (!v.ok) {
    return { ok: false, error: v.error };
  }

  const merged = {
    ...state.userServers,
    [name]: config,
  };

  return applyMcpServers(query, merged, state);
}

// ─── Remove single server ────────────────────────────────────────────────────

/**
 * Remove a single MCP server from the running session. Rebuilds the config
 * without the named server and re-applies.
 */
export async function removeMcpServer(
  query: ClaudePtyController,
  name: string,
  state: McpServerState,
): Promise<McpApplyResult> {
  if (PROTECTED_SERVER_NAMES.has(name)) {
    return { ok: false, error: `server '${name}' is protected and cannot be removed` };
  }

  const { [name]: _removed, ...remaining } = state.userServers;

  return applyMcpServers(query, remaining, state);
}

// ─── Sync from registry ──────────────────────────────────────────────────────

/**
 * Sync MCP servers from the account-level registry into the running session.
 * Registry servers are merged with any manually-added user servers (manual
 * additions take precedence for same-name conflicts).
 *
 * @param query - Active SDK Query
 * @param registryServers - SDK-format server configs from `registryToSdkConfig()`
 * @param state - Mutable state tracker
 */
export async function syncMcpServersFromRegistry(
  query: ClaudePtyController,
  registryServers: Record<string, Record<string, unknown>>,
  state: McpServerState,
): Promise<McpApplyResult> {
  // Registry is base, manual user additions override
  const merged = {
    ...registryServers,
    ...state.userServers,
  };

  // Skip validation for registry servers — they were already validated by
  // the registry Zod schema. Filter out any protected names silently.
  const filtered: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(merged)) {
    if (PROTECTED_SERVER_NAMES.has(name)) {
      logger.debug(`[mcpServerManager] Skipping protected name '${name}' from registry sync`);
      continue;
    }
    filtered[name] = config;
  }

  // Build full config
  const fullConfig = {
    ...state.protectedServers,
    ...filtered,
  };

  try {
    const result = await query.setMcpServers(fullConfig as any);

    state.userServers = filtered;
    state.lastSyncAt = Date.now();

    logger.debug(
      `[mcpServerManager] Registry sync: added=${result.added.join(",") || "none"} removed=${result.removed.join(",") || "none"}`,
    );

    return {
      ok: true,
      added: result.added,
      removed: result.removed,
      errors: result.errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[mcpServerManager] Registry sync failed: ${msg}`);
    return { ok: false, error: msg };
  }
}
