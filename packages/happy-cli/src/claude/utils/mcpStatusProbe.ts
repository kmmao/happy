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
 *     A bare PATH-resolve cannot detect a binary that exists but won't speak
 *     MCP, but a missing binary is the most common misconfiguration we can
 *     rule out cheaply.
 *
 *     OPT-IN deep probe (HAPPY_MCP_HANDSHAKE_PROBE=1): once the command
 *     resolves, actually spawn it and perform a real MCP `initialize`
 *     JSON-RPC handshake over stdio (timeout HAPPY_MCP_HANDSHAKE_TIMEOUT_MS,
 *     default 3 s). A successful handshake is the only thing that proves the
 *     binary really speaks MCP, so it upgrades to a high-confidence
 *     `"connected"` cached for 5 min (the spawn is expensive). A failed or
 *     timed-out handshake degrades back to the PATH-resolve result rather
 *     than reporting `"failed"` — MCP servers can be slow to start, need a
 *     specific cwd/env, or require auth, so a probe miss is not proof the
 *     server is broken. Off by default because it spawns the user's
 *     configured command as a side effect of a status poll.
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
import { spawn } from "node:child_process";
import path from "node:path";
import { logger } from "@/ui/logger";

const PROBE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 2000;
// Successful MCP `initialize` handshakes are cached far longer than the cheap
// PATH-resolve / HTTP probes because each one costs a full child-process spawn.
const HANDSHAKE_TTL_MS = 5 * 60_000;

export type McpProbeStatus = "connected" | "failed" | "disabled";

export interface McpProbeResult {
  status: McpProbeStatus;
  error?: string;
  /** Wall-clock ms when the probe was performed. */
  checkedAt: number;
  /**
   * Override for how long this specific result stays warm in the cache.
   * Defaults to {@link PROBE_TTL_MS} when unset; the stdio handshake sets the
   * longer {@link HANDSHAKE_TTL_MS} on success since re-spawning is costly.
   */
  ttlMs?: number;
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
  // stdio MCP: PATH-resolve the configured command, then (opt-in) perform a
  // real `initialize` handshake. PATH-resolve alone catches the most common
  // misconfig (typo / missing dependency) for free; the handshake confirms
  // the binary actually speaks MCP. See module doc + probeStdioCommand.
  if (type === "stdio") {
    const command = typeof cfg.command === "string" ? cfg.command : "";
    if (!command) return failed("stdio config missing 'command'");
    const args = Array.isArray(cfg.args)
      ? cfg.args.filter((a): a is string => typeof a === "string")
      : [];
    const env =
      cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)
        ? (cfg.env as Record<string, string>)
        : {};
    // Key on command + args: different args are different upstreams, and the
    // handshake spawns exactly this argv, so they must not share a cache slot.
    const key = `stdio:${command}\0${args.join("\0")}`;
    return cached(key, () => probeStdioCommand(command, args, env, name));
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
  // Reuse a cached result that's still warm. TTL is per-result so a
  // handshake-confirmed "connected" can outlive a cheap PATH-resolve hit.
  if (entry && now - entry.result.checkedAt < (entry.result.ttlMs ?? PROBE_TTL_MS)) {
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

async function probeStdioCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  name: string,
): Promise<McpProbeResult> {
  const resolved = await resolveStdioCommand(command, name);
  // Command missing / not executable → definitively failed; spawning would
  // just reproduce the same ENOENT, so skip the expensive handshake.
  if (resolved.status !== "connected") return resolved;

  // Opt-in deep probe. Off by default: spawning the user's configured MCP
  // command as a side effect of a status poll can have real consequences
  // (DB connections, file locks, telemetry) and costs a subprocess per
  // server per cache cycle.
  if (process.env.HAPPY_MCP_HANDSHAKE_PROBE !== "1") {
    return resolved;
  }

  const handshake = await probeStdioHandshake(command, args, env, name);
  // Only UPGRADE confidence on success. A failed/timed-out handshake degrades
  // to the PATH-resolve result instead of "failed" (see module doc): a probe
  // miss is not proof the server is broken.
  if (handshake.status === "connected") return handshake;
  logger.debug(
    `[mcpStatusProbe] '${name}' handshake inconclusive (${handshake.error ?? "?"}); degrading to PATH-resolve`,
  );
  return resolved;
}

async function resolveStdioCommand(command: string, name: string): Promise<McpProbeResult> {
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

/**
 * Spawn the stdio MCP server and perform a real MCP `initialize` JSON-RPC
 * handshake over its stdin/stdout. Resolves `"connected"` (with the long
 * {@link HANDSHAKE_TTL_MS}) only when the server returns a valid initialize
 * result; every other outcome — spawn error, early exit, JSON-RPC error,
 * timeout — resolves `"failed"` so the caller can degrade gracefully.
 *
 * The child is always killed once we have an answer: we only need the
 * handshake, never a long-lived connection. Never throws — the Promise
 * always resolves so `cached()` gets a deterministic result.
 */
function probeStdioHandshake(
  command: string,
  args: string[],
  env: Record<string, string>,
  name: string,
): Promise<McpProbeResult> {
  // stdio JSON-RPC transport frames each message as one line of JSON.
  const INITIALIZE_ID = 1;
  const request =
    JSON.stringify({
      jsonrpc: "2.0",
      id: INITIALIZE_ID,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "happy-cli-probe", version: "1.0.0" },
      },
    }) + "\n";

  const timeoutMs = Math.max(
    250,
    Number(process.env.HAPPY_MCP_HANDSHAKE_TIMEOUT_MS) || 3000,
  );

  return new Promise<McpProbeResult>((resolve) => {
    let settled = false;
    let stdout = "";

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        // Inherit the daemon env so the server finds node_modules / auth, plus
        // any per-server overrides. stderr is ignored — servers log there.
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (err) {
      resolve(failed(err instanceof Error ? err.message : String(err)));
      return;
    }

    const finish = (result: McpProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners();
      // We only needed the handshake — reclaim the child immediately.
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(failed(`initialize handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err: Error) => {
      finish(failed(err.message));
    });

    child.on("exit", (code) => {
      finish(failed(`process exited (code ${code}) before initialize response`));
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      let nl: number;
      while ((nl = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          // Non-JSON banner / log line on stdout — skip, keep reading.
          continue;
        }
        // Ignore notifications and unrelated ids; match our initialize reply.
        if (!msg || msg.id !== INITIALIZE_ID) continue;
        if (msg.error) {
          finish(failed(`initialize error: ${msg.error?.message ?? "unknown"}`));
        } else if (msg.result) {
          finish({ status: "connected", checkedAt: Date.now(), ttlMs: HANDSHAKE_TTL_MS });
        } else {
          finish(failed("initialize response missing result"));
        }
        return;
      }
    });

    // Swallow EPIPE: if the server exits before/while we write the request,
    // the stdin pipe breaks and emits 'error'. The exit/timeout handlers
    // already settle the probe, so this listener just prevents an unhandled
    // stream error from crashing the process.
    child.stdin?.on("error", () => {});
    try {
      child.stdin?.write(request);
    } catch (err) {
      finish(failed(err instanceof Error ? err.message : String(err)));
    }
    logger.debug(`[mcpStatusProbe] '${name}' initialize handshake → ${command} ${args.join(" ")}`);
  });
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
