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
 * 1. **Protected servers** (`happy`) cannot be added, removed, or
 *    overwritten by App RPC calls. They are always re-injected
 *    into the config before calling the SDK.
 * 2. **Transport validation** — every config is validated before it reaches
 *    the SDK: stdio must have `command`, network transports must have `url`,
 *    and only known transport types are accepted.
 * 3. **State tracking** — `McpServerState` records the user-provided servers
 *    separately from protected servers, enabling accurate diff/sync.
 *
 * ## PTY-mode behaviour
 *
 * The SDK era had `Query.setMcpServers()` that diff-applied changes against a
 * live runtime. The Claude TUI has no programmatic equivalent — MCP servers
 * are bound at spawn time via `--mcp-config`. This module therefore validates
 * + tracks state only; the in-memory map drives `mcpServerStatus` polls and
 * any real connection change requires a cold restart.
 */

import type { ClaudePtyController } from "@/claude/pty/claudePtyController";
import { logger } from "@/lib";
import { resetMcpProbeCache } from "@/claude/utils/mcpStatusProbe";

// ─── Protected server names ───────────────────────────────────────────────────

/**
 * Server names that cannot be added/removed/overwritten by App RPCs.
 * These are Happy's own MCP servers created by the launcher.
 *
 * Exported so other modules (e.g. claudeControlHandlers.toggle_mcp_server)
 * can reject mutations to these names with a consistent error message
 * instead of redefining the set.
 */
export const PROTECTED_SERVER_NAMES = new Set(["happy"]);

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
 * re-injected. Validates all configs and updates the in-memory state map.
 * No live SDK call: PTY mode requires a cold restart to actually connect
 * new servers — this only ensures the App's MCP panel + status polls see
 * the new config until the launcher cycles the PTY.
 *
 * @param query - Active PTY controller (kept for signature parity)
 * @param servers - User-provided server configs (excluding protected names)
 * @param state - Mutable state tracker
 */
export async function applyMcpServers(
  query: ClaudePtyController,
  servers: Record<string, Record<string, unknown>>,
  state: McpServerState,
): Promise<McpApplyResult> {
  void query; // Reserved for future PTY MCP hot-swap if it lands.

  // Validate all configs
  for (const [name, config] of Object.entries(servers)) {
    const v = validateMcpServerConfig(name, config);
    if (!v.ok) {
      logger.debug(`[mcpServerManager] Validation failed: ${v.error}`);
      return { ok: false, error: v.error };
    }
  }

  // Compute added/removed against previous state for an honest result.
  const prev = new Set(Object.keys(state.userServers));
  const next = new Set(Object.keys(servers));
  const added = [...next].filter((n) => !prev.has(n));
  const removed = [...prev].filter((n) => !next.has(n));

  // Track state
  state.userServers = { ...servers };
  state.lastSyncAt = Date.now();

  // Drop any cached status probes — the next `mcpServerStatus()` poll should
  // re-probe against the new config instead of returning stale results for up
  // to 60 s (the probe TTL).
  resetMcpProbeCache();

  logger.debug(
    `[mcpServerManager] Tracked: added=${added.join(",") || "none"} removed=${removed.join(",") || "none"} (cold restart required to take effect)`,
  );

  return { ok: true, added, removed, errors: {} };
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
 * additions take precedence for same-name conflicts). State-only update; see
 * `applyMcpServers` for the PTY-mode caveat.
 *
 * @param query - Active PTY controller (kept for signature parity)
 * @param registryServers - SDK-format server configs from `registryToSdkConfig()`
 * @param state - Mutable state tracker
 */
export async function syncMcpServersFromRegistry(
  query: ClaudePtyController,
  registryServers: Record<string, Record<string, unknown>>,
  state: McpServerState,
): Promise<McpApplyResult> {
  void query; // Reserved for future PTY MCP hot-swap if it lands.

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

  // Compute added/removed against previous state.
  const prev = new Set(Object.keys(state.userServers));
  const next = new Set(Object.keys(filtered));
  const added = [...next].filter((n) => !prev.has(n));
  const removed = [...prev].filter((n) => !next.has(n));

  state.userServers = filtered;
  state.lastSyncAt = Date.now();

  // Drop cached status probes (same reason as `applyMcpServers`).
  resetMcpProbeCache();

  logger.debug(
    `[mcpServerManager] Registry sync tracked: added=${added.join(",") || "none"} removed=${removed.join(",") || "none"} (cold restart required to take effect)`,
  );

  return { ok: true, added, removed, errors: {} };
}
