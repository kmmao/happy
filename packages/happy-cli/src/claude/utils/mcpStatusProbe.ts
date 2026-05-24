/**
 * mcpStatusProbe — cached, best-effort reachability checks for configured MCP
 * servers in PTY mode.
 *
 * Background
 * ----------
 * Pre-PTY, the SDK exposed a live `Query.mcpServerStatus()` that returned the
 * actual connect state for each MCP server. In PTY mode the Claude TUI is a
 * subprocess we cannot introspect, so earlier revisions just reported
 * `"connected"` for every configured server. That was a lie: a typoed stdio
 * `command` (`whisper` instead of `whisperd`) or a down HTTP MCP endpoint
 * would silently appear green in the App, and tool calls would only fail at
 * the moment the user invoked them.
 *
 * This module replaces that fiction with cheap, cached probes:
 *
 *   - stdio MCP → resolve `command` against the user's PATH (cached 60 s).
 *     A missing binary becomes `"failed"` with a `command not found` error.
 *     We cannot detect a binary that exists but won't speak MCP — that needs
 *     the launcher / claude itself — but a missing binary is the most common
 *     misconfiguration we can rule out cheaply.
 *
 *   - http/sse/streamable-http/url MCP → HEAD/GET ping (2 s timeout, cached
 *     60 s). 2xx/3xx/4xx maps to `"connected"`; network errors / 5xx /
 *     timeouts map to `"failed"` with the upstream message.
 *
 *   - disabled MCP → `"disabled"`, no probe.
 *
 * The cache is keyed by the probe target (URL or absolute command path) so
 * two servers pointing at the same upstream share a single probe. Cache TTL
 * is generous (60 s) because the App polls `mcpServerStatus` every 30 s and
 * we want probe storms — `find /` could otherwise generate dozens of HTTP
 * pings per minute.
 *
 * Failure mode: every probe path is wrapped in `try/catch` and returns a
 * `"failed"` result rather than throwing. The controller treats this module
 * as a hint, not a contract — if everything throws we fall back to the
 * "configured, optimistic" status to preserve the App's panel.
 */

import { access, constants } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/ui/logger";

const PROBE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 2000;

export type McpProbeStatus = "connected" | "failed" | "disabled";

export interface McpProbeResult {
  status: McpProbeStatus;
  error?: string;
  /** Wall-clock ms when the probe was performed. */
  checkedAt: number;
}

interface CacheEntry {
  result: McpProbeResult;
  /** Resolves to the probe in flight, so concurrent callers share one request. */
  inFlight: Promise<McpProbeResult> | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * Probe a single MCP server config. Cached for {@link PROBE_TTL_MS}; second
 * caller within that window gets the cached result without a re-probe.
 *
 * @param name   Server name — only used for log lines, never the cache key.
 * @param config The raw config object from `getMcpServers()`. We accept
 *               `Record<string, unknown>` because user-provided MCP entries
 *               are loose JSON at this layer.
 */
export async function probeMcpServer(
  name: string,
  config: unknown,
): Promise<McpProbeResult> {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return failed("config is not an object");
  }
  const cfg = config as Record<string, unknown>;
  if (cfg.disabled === true) {
    return { status: "disabled", checkedAt: Date.now() };
  }

  const type = typeof cfg.type === "string" ? cfg.type : "stdio";
  // stdio MCP: PATH-resolve the configured command. Doesn't validate the
  // binary actually speaks MCP — that's the launcher's job — but catches
  // the most common misconfig (typo / missing dependency) for free.
  if (type === "stdio") {
    const command = typeof cfg.command === "string" ? cfg.command : "";
    if (!command) return failed("stdio config missing 'command'");
    return cached(`stdio:${command}`, () => probeStdioCommand(command, name));
  }

  // URL-based MCP transports: cheap HEAD/GET ping. We don't issue an MCP
  // `initialize` JSON-RPC because that requires a full transport handshake
  // (HTTP+SSE upgrade for sse, websocket for streamable, etc.) and would
  // be too expensive at poll frequency. Server reachability is a good
  // enough proxy for "would Claude be able to connect?".
  if (type === "sse" || type === "http" || type === "streamable-http" || type === "url") {
    const url = typeof cfg.url === "string" ? cfg.url : "";
    if (!url) return failed(`${type} config missing 'url'`);
    return cached(`url:${url}`, () => probeUrl(url, name));
  }

  return failed(`unknown transport type '${type}'`);
}

/**
 * Drop cached probe results — call when the launcher reconfigures the MCP
 * map (toggle / add / remove) so the next poll re-probes against the new
 * config rather than returning stale state for 60 s.
 */
export function resetMcpProbeCache(): void {
  cache.clear();
}

// ── internals ─────────────────────────────────────────────────────────────────

function failed(error: string): McpProbeResult {
  return { status: "failed", error, checkedAt: Date.now() };
}

async function cached(
  key: string,
  perform: () => Promise<McpProbeResult>,
): Promise<McpProbeResult> {
  const now = Date.now();
  const entry = cache.get(key);
  // Reuse a cached result that's still warm.
  if (entry && now - entry.result.checkedAt < PROBE_TTL_MS) {
    return entry.result;
  }
  // Coalesce: another caller's probe is in flight — share it instead of
  // racing two requests against the same upstream.
  if (entry?.inFlight) {
    return entry.inFlight;
  }

  const promise = perform()
    .then((res) => {
      cache.set(key, { result: res, inFlight: null });
      return res;
    })
    .catch((err) => {
      // Never let exceptions escape — the controller wants a deterministic
      // shape. Cache the failure so we don't hammer the upstream.
      const result = failed(err instanceof Error ? err.message : String(err));
      cache.set(key, { result, inFlight: null });
      return result;
    });

  cache.set(key, {
    result: entry?.result ?? { status: "failed", checkedAt: 0 },
    inFlight: promise,
  });
  return promise;
}

async function probeStdioCommand(command: string, name: string): Promise<McpProbeResult> {
  // Absolute or relative path: stat directly. Relative path is resolved
  // against the daemon's cwd, which matches how `node-pty` would resolve
  // it when actually spawning the child.
  if (command.startsWith("/") || command.startsWith("./") || command.startsWith("../")) {
    return canExecute(path.resolve(command)).then((ok) =>
      ok
        ? { status: "connected", checkedAt: Date.now() }
        : failed(`command not executable: ${command}`),
    );
  }

  // Bare name → walk PATH. Mirrors POSIX `command -v` semantics: first
  // executable hit wins. We deliberately don't handle PATHEXT/extensions on
  // Windows because the CLI's only-tested platforms are macOS/Linux today,
  // and adding Windows resolution silently changes behavior on macOS too
  // (e.g. `node.cmd` shouldn't shadow `node`).
  const PATH = process.env.PATH ?? "";
  if (!PATH) return failed("PATH is empty");
  const dirs = PATH.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (await canExecute(candidate)) {
      return { status: "connected", checkedAt: Date.now() };
    }
  }
  logger.debug(`[mcpStatusProbe] '${name}' command '${command}' not found in PATH`);
  return failed(`command not found in PATH: ${command}`);
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function probeUrl(url: string, name: string): Promise<McpProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    // HEAD is cheap and most MCP servers respond; if HEAD isn't supported
    // (some streamable-http servers reject non-POST), the fall-through GET
    // catches that case. We swallow the GET 4xx as "reachable" because the
    // upstream is plainly answering — only network errors / 5xx are real
    // failures from a probe perspective.
    let res: Response;
    try {
      res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    } catch {
      res = await fetch(url, { method: "GET", signal: ctrl.signal });
    }
    if (res.status >= 500) {
      return failed(`HTTP ${res.status}`);
    }
    return { status: "connected", checkedAt: Date.now() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[mcpStatusProbe] '${name}' probe ${url} failed: ${msg}`);
    return failed(msg);
  } finally {
    clearTimeout(timer);
  }
}
