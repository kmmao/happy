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
 * `http://127.0.0.1:54321/`), serving the `happy` namespace.
 *
 * The server is marked `alwaysLoad: true` so happy tools (permission
 * prompts, App sync) stay attached when Claude reloads tool config
 * mid-session — otherwise the App appears to go briefly "deaf" until the
 * user invokes a happy tool again.
 */
export function buildHappyMcpServers(
  httpUrl: string,
): Record<string, HappyMcpServerEntry> {
  const normalized = httpUrl.endsWith("/") ? httpUrl.slice(0, -1) : httpUrl;
  return {
    happy: { type: "http", url: normalized, alwaysLoad: true },
  };
}

/**
 * Build the JSON object written to settings.json. Exposed for tests so we
 * can assert on the shape without round-tripping through the filesystem.
 *
 * Hook is emitted in Claude Code 2.1.139+ exec form: `command` holds the
 * executable, `args` holds the argv tail. Claude runs `execvp(command,
 * args)` directly — no `sh -c`, so the forwarder path can contain spaces,
 * quotes, `$()`, backticks, semicolons, etc. without shell-injection risk.
 *
 * The previous shape `{command: 'node "<path>" <port>'}` was a shell
 * string. It worked, but a forwarder path or a port value containing any
 * shell metacharacter would either break parsing or smuggle commands.
 * Codium pins `@anthropic-ai/claude-code@2.1.157`, so the runtime CLI is
 * already guaranteed to be ≥ 2.1.139 in supported deployments.
 */
export function buildHookSettings(port: number): Record<string, unknown> {
  const forwarderScript = resolve(
    projectPath(),
    "scripts",
    "session_hook_forwarder.cjs",
  );

  const hookEntry = [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "node",
          args: [forwarderScript, String(port)],
        },
      ],
    },
  ];

  return {
    hooks: {
      SessionStart: hookEntry,
      StopFailure: hookEntry,
      // Optional session-state hooks (Claude Code 2.1.121+ for CwdChanged /
      // FileChanged, 2.1.157+ for Worktree*). Unknown events on older CLIs
      // are silently ignored — the user just doesn't see live cwd / worktree
      // updates in the App. The forwarder hands every event off by name; the
      // dispatch table in startHookServer.ts decides what to do with each.
      CwdChanged: hookEntry,
      FileChanged: hookEntry,
      WorktreeCreate: hookEntry,
      WorktreeRemove: hookEntry,
      // Observability hooks verified present in claude-code 2.1.157's
      // HookEvent union. Same fire-and-forget treatment: the forwarder ships
      // each by name and startHookServer's dispatch table decides what to do.
      // Unknown events on older CLIs are silently ignored.
      InstructionsLoaded: hookEntry,
      PermissionDenied: hookEntry,
      PostToolBatch: hookEntry,
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
