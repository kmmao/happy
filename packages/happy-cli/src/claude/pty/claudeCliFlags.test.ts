/**
 * claudeCliFlags — translation table tests.
 *
 * Each test pins one EnhancedMode shape → expected argv (or warning).
 * When the upstream `claude` CLI changes a flag name, the test that
 * pins it will fail first and force a deliberate update.
 */

import { describe, it, expect } from "vitest";
import { buildClaudeCliFlags } from "./claudeCliFlags";
import type { EnhancedMode } from "@/claude/loop";

function modeFrom(partial: Partial<EnhancedMode>): EnhancedMode {
  return {
    permissionMode: "default",
    ...partial,
  };
}

describe("buildClaudeCliFlags", () => {
  it("returns empty args when no inputs", () => {
    const { args, warnings } = buildClaudeCliFlags({});
    expect(args).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("resume wins over new session id", () => {
    const { args } = buildClaudeCliFlags({
      resumeSessionId: "old-uuid",
      newSessionId: "new-uuid",
    });
    expect(args).toEqual(["--resume", "old-uuid"]);
  });

  it("new session id used when no resume", () => {
    const { args } = buildClaudeCliFlags({ newSessionId: "new-uuid" });
    expect(args).toEqual(["--session-id", "new-uuid"]);
  });

  it("permissionMode plan → --permission-mode plan", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ permissionMode: "plan" }),
    });
    expect(args).toEqual(["--permission-mode", "plan"]);
  });

  it("permissionMode default → no flag", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ permissionMode: "default" }),
    });
    expect(args).toEqual([]);
  });

  it("permissionMode bypassPermissions → --dangerously-skip-permissions", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ permissionMode: "bypassPermissions" }),
    });
    expect(args).toEqual(["--dangerously-skip-permissions"]);
  });

  it("model + fallbackModel emit --model + --fallback-model", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({
        model: "claude-opus-4-6",
        fallbackModel: "claude-sonnet-4-6",
      }),
    });
    expect(args).toEqual([
      "--model",
      "claude-opus-4-6",
      "--fallback-model",
      "claude-sonnet-4-6",
    ]);
  });

  it("appendSystemPrompt → --append-system-prompt", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ appendSystemPrompt: "always explain reasoning" }),
    });
    expect(args).toEqual(["--append-system-prompt", "always explain reasoning"]);
  });

  it("allowedTools + disallowedTools comma-joined", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({
        allowedTools: ["Bash", "Read"],
        disallowedTools: ["Write"],
      }),
    });
    expect(args).toEqual([
      "--allowedTools",
      "Bash,Read",
      "--disallowedTools",
      "Write",
    ]);
  });

  it("additionalDirectories → repeated --add-dir", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({
        additionalDirectories: ["/a", "/b", "/c"],
      }),
    });
    expect(args).toEqual([
      "--add-dir",
      "/a",
      "--add-dir",
      "/b",
      "--add-dir",
      "/c",
    ]);
  });

  it("betas → comma-joined --betas", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ betas: ["context-1m-2025-08-07"] }),
    });
    expect(args).toEqual(["--betas", "context-1m-2025-08-07"]);
  });

  it("continue → --continue", () => {
    const { args } = buildClaudeCliFlags({
      mode: modeFrom({ continue: true }),
    });
    expect(args).toEqual(["--continue"]);
  });

  it("mcpServers serialise to --mcp-config JSON", () => {
    const { args } = buildClaudeCliFlags({
      mcpServers: { foo: { type: "http", url: "http://x" } },
    });
    expect(args.length).toBe(2);
    expect(args[0]).toBe("--mcp-config");
    expect(JSON.parse(args[1])).toEqual({
      mcpServers: { foo: { type: "http", url: "http://x" } },
    });
  });

  it("settingsPath → --settings", () => {
    const { args } = buildClaudeCliFlags({ settingsPath: "/tmp/x.json" });
    expect(args).toEqual(["--settings", "/tmp/x.json"]);
  });

  it("extraArgs appended verbatim at the tail", () => {
    const { args } = buildClaudeCliFlags({
      newSessionId: "uuid",
      extraArgs: ["--debug", "--no-banner"],
    });
    expect(args).toEqual(["--session-id", "uuid", "--debug", "--no-banner"]);
  });

  it("thinking emits a capability-loss warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ thinking: { type: "enabled", budgetTokens: 5000 } }),
    });
    expect(warnings.some((w) => /thinking/i.test(w))).toBe(true);
  });

  it("effort emits a capability-loss warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ effort: "high" }),
    });
    expect(warnings.some((w) => /effort/i.test(w))).toBe(true);
  });

  it("outputFormat emits a capability-loss warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ outputFormat: { type: "json", schema: {} } as any }),
    });
    expect(warnings.some((w) => /outputFormat/i.test(w))).toBe(true);
  });

  it("shouldQuery=false emits warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ shouldQuery: false }),
    });
    expect(warnings.some((w) => /shouldQuery/i.test(w))).toBe(true);
  });

  it("customSystemPrompt emits guidance warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ customSystemPrompt: "x" }),
    });
    expect(warnings.some((w) => /customSystemPrompt/i.test(w))).toBe(true);
  });

  it("maxBudgetUsd emits a settings.json hint warning", () => {
    const { warnings } = buildClaudeCliFlags({
      mode: modeFrom({ maxBudgetUsd: 5 }),
    });
    expect(warnings.some((w) => /maxBudgetUsd/i.test(w))).toBe(true);
  });

  it("comprehensive: combines many fields in expected order", () => {
    const { args } = buildClaudeCliFlags({
      resumeSessionId: "resume-uuid",
      mode: modeFrom({
        permissionMode: "acceptEdits",
        model: "claude-opus-4-6",
        appendSystemPrompt: "hi",
        allowedTools: ["Bash"],
        continue: false, // false branch — flag NOT pushed
      }),
      mcpServers: { foo: { type: "http", url: "u" } },
      settingsPath: "/tmp/s.json",
      extraArgs: ["--verbose"],
    });
    expect(args.slice(0, 2)).toEqual(["--resume", "resume-uuid"]);
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-6");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("hi");
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Bash");
    expect(args).not.toContain("--continue");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("--settings");
    expect(args).toContain("/tmp/s.json");
    expect(args[args.length - 1]).toBe("--verbose");
  });
});
