/**
 * Generate temporary settings file for Claude TUI's `--settings <path>`.
 *
 * What lives in this file
 * -----------------------
 *   • SessionStart / StopFailure hooks pointing at our local hook
 *     forwarder so we observe session lifecycle events out of band.
 *
 * What does NOT live here
 * -----------------------
 *   • MCP server config. The Phase 4 PoC (scripts/poc-http-mcp-injection.mjs)
 *     proved that claude TUI does *not* honour `mcpServers` from
 *     `--settings <path>` — only `--mcp-config <json|path>` works. So
 *     Happy's HTTP MCP URLs are composed via `buildHappyMcpServers()`
 *     here and then handed to `buildClaudeCliFlags({ mcpServers })`,
 *     which serialises them into `--mcp-config`. See
 *     `src/claude/pty/claudeCliFlags.ts`.
 */

import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { configuration } from "@/configuration";
import { logger } from "@/ui/logger";
import { projectPath } from "@/projectPath";

/**
 * Shape of a single MCP server entry. Used by `buildHappyMcpServers`
 * (consumed downstream by `claudeCliFlags.mcpServers` → `--mcp-config`).
 *
 * `alwaysLoad` (Claude Code 2.1.121+) opts the server out of tool-search
 * deferral so its tools stay loaded across `/clear`, plan-mode toggles,
 * and skill activations. Unknown to older CLIs — they ignore it.
 */
export type HappyMcpServerEntry =
  | { type: "http"; url: string; headers?: Record<string, string>; alwaysLoad?: boolean }
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; alwaysLoad?: boolean }
  | { type: "sse"; url: string; headers?: Record<string, string>; alwaysLoad?: boolean };

/**
 * Build the Happy MCP server config block. Pass the result through
 * `claudeCliFlags.mcpServers` to inject it via `--mcp-config`.
 *
 * `httpUrl` is the base URL from `startHappyServer()` (e.g.
 * `http://127.0.0.1:54321/`). The same URL serves both the `happy` and
 * (when knowledge is enabled) `happy-knowledge` namespaces — they're
 * registered as separate MCP servers so the App / claude can address them
 * by name, but the actual transport is a single HTTP endpoint.
 *
 * Both servers are marked `alwaysLoad: true` so happy tools (permission
 * prompts, App sync, knowledge lookup) stay attached when Claude reloads
 * tool config mid-session — otherwise the App appears to go briefly
 * "deaf" until the user invokes a happy tool again.
 */
export function buildHappyMcpServers(
  httpUrl: string,
  options: { includeKnowledge?: boolean } = {},
): Record<string, HappyMcpServerEntry> {
  const normalized = httpUrl.endsWith("/") ? httpUrl.slice(0, -1) : httpUrl;
  const out: Record<string, HappyMcpServerEntry> = {
    happy: { type: "http", url: normalized, alwaysLoad: true },
  };
  if (options.includeKnowledge) {
    out["happy-knowledge"] = { type: "http", url: normalized, alwaysLoad: true };
  }
  return out;
}

/**
 * Build the JSON object written to settings.json. Exposed for tests so we
 * can assert on the shape without round-tripping through the filesystem.
 */
export function buildHookSettings(port: number): Record<string, unknown> {
  const forwarderScript = resolve(
    projectPath(),
    "scripts",
    "session_hook_forwarder.cjs",
  );
  const hookCommand = `node "${forwarderScript}" ${port}`;

  const hookEntry = [
    {
      matcher: "*",
      hooks: [{ type: "command", command: hookCommand }],
    },
  ];

  return {
    hooks: {
      SessionStart: hookEntry,
      StopFailure: hookEntry,
    },
  };
}

/**
 * Generate a temporary settings file for `claude --settings <path>`.
 *
 * @param port - The port where Happy server is listening
 * @returns Path to the generated settings file
 */
export function generateHookSettingsFile(port: number): string {
  const hooksDir = join(configuration.happyHomeDir, "tmp", "hooks");
  mkdirSync(hooksDir, { recursive: true });

  // Unique filename per process to avoid conflicts.
  const filename = `session-hook-${process.pid}.json`;
  const filepath = join(hooksDir, filename);

  const settings = buildHookSettings(port);
  writeFileSync(filepath, JSON.stringify(settings, null, 2));
  logger.debug(`[generateHookSettings] Created hook settings file: ${filepath}`);

  return filepath;
}

/**
 * Clean up the temporary hook settings file.
 *
 * @param filepath - Path to the settings file to remove
 */
export function cleanupHookSettingsFile(filepath: string): void {
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
      logger.debug(
        `[generateHookSettings] Cleaned up hook settings file: ${filepath}`,
      );
    }
  } catch (error) {
    logger.debug(
      `[generateHookSettings] Failed to cleanup hook settings file: ${error}`,
    );
  }
}
