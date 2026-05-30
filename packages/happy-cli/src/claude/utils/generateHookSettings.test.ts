/**
 * generateHookSettings — settings.json + HTTP MCP helper tests.
 *
 * Phase 4 PoC finding: claude TUI's `--settings <path>` does NOT honour
 * `mcpServers` in the file (verified empirically with
 * scripts/poc-http-mcp-injection.mjs). MCP injection must go via
 * `--mcp-config <json>`. The `buildHappyMcpServers` helper produces the
 * map that `claudeCliFlags.mcpServers` will serialize into --mcp-config.
 *
 * These tests pin:
 *   • the settings.json structure (hooks only — no mcpServers key)
 *   • the Happy MCP server builder (URL normalisation, knowledge toggle)
 */

import { describe, it, expect } from "vitest";
import {
  buildHookSettings,
  buildHappyMcpServers,
} from "./generateHookSettings";

type HookEntry = {
  matcher: string;
  hooks: Array<{ type: string; command: string; args?: string[] }>;
};

describe("buildHookSettings", () => {
  it("emits SessionStart and StopFailure hooks for the given port", () => {
    const settings = buildHookSettings(12345);
    expect(settings.hooks).toBeDefined();
    const hooks = settings.hooks as Record<string, HookEntry[]>;
    expect(Array.isArray(hooks.SessionStart)).toBe(true);
    expect(Array.isArray(hooks.StopFailure)).toBe(true);

    const entry = hooks.SessionStart[0];
    const hook = entry.hooks[0];
    expect(hook.command).toBe("node");
    expect(hook.args).toEqual([
      expect.stringMatching(/session_hook_forwarder\.cjs$/),
      "12345",
    ]);
  });

  it("uses Claude Code 2.1.139+ exec form (args array, not shell string) so a forwarder path with spaces / quotes / shell metacharacters cannot be misparsed or injected", () => {
    const settings = buildHookSettings(54321);
    const hooks = (settings.hooks as Record<string, HookEntry[]>).SessionStart[0]
      .hooks[0];
    // command is the executable, NOT a shell pipeline.
    expect(hooks.command).toBe("node");
    // args is the argv tail; port is stringified.
    expect(Array.isArray(hooks.args)).toBe(true);
    expect(hooks.args).toContain("54321");
    // No embedded quoting / interpolation must leak in.
    expect(hooks.command).not.toMatch(/[" $`;|&]/);
  });

  it("SessionStart and StopFailure share the same exec entry shape", () => {
    const settings = buildHookSettings(8080);
    const hooks = settings.hooks as Record<string, HookEntry[]>;
    expect(hooks.StopFailure[0]).toEqual(hooks.SessionStart[0]);
  });

  it("never carries mcpServers (use --mcp-config instead)", () => {
    const settings = buildHookSettings(1);
    expect("mcpServers" in settings).toBe(false);
  });
});

describe("buildHappyMcpServers", () => {
  it("returns happy only by default", () => {
    const map = buildHappyMcpServers("http://127.0.0.1:54321/");
    expect(map).toEqual({
      happy: { type: "http", url: "http://127.0.0.1:54321", alwaysLoad: true },
    });
  });

  it("includes happy-knowledge when requested", () => {
    const map = buildHappyMcpServers("http://127.0.0.1:54321", {
      includeKnowledge: true,
    });
    expect(map).toEqual({
      happy: { type: "http", url: "http://127.0.0.1:54321", alwaysLoad: true },
      "happy-knowledge": {
        type: "http",
        url: "http://127.0.0.1:54321",
        alwaysLoad: true,
      },
    });
  });

  it("strips a single trailing slash but preserves nested paths", () => {
    expect(buildHappyMcpServers("http://127.0.0.1:1234/mcp/")).toEqual({
      happy: { type: "http", url: "http://127.0.0.1:1234/mcp", alwaysLoad: true },
    });
    expect(buildHappyMcpServers("http://127.0.0.1:1234/mcp")).toEqual({
      happy: { type: "http", url: "http://127.0.0.1:1234/mcp", alwaysLoad: true },
    });
  });

  it("marks every server with alwaysLoad=true so happy tools survive Claude's tool-search deferral (Claude Code 2.1.121+)", () => {
    const map = buildHappyMcpServers("http://127.0.0.1:1234", {
      includeKnowledge: true,
    });
    for (const entry of Object.values(map)) {
      expect(entry.alwaysLoad).toBe(true);
    }
  });

  it("output shape matches what claudeCliFlags expects in `mcpServers`", () => {
    // claudeCliFlags.ts JSON.stringify's `{ mcpServers: input.mcpServers }`
    // and passes it as `--mcp-config <json>`. The PoC confirmed this round-trips.
    const map = buildHappyMcpServers("http://127.0.0.1:1234");
    const wire = JSON.stringify({ mcpServers: map });
    expect(JSON.parse(wire)).toEqual({
      mcpServers: {
        happy: {
          type: "http",
          url: "http://127.0.0.1:1234",
          alwaysLoad: true,
        },
      },
    });
  });
});
