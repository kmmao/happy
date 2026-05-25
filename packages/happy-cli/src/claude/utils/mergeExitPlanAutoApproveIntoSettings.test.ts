/**
 * mergeExitPlanAutoApproveIntoSettings — patch-shape tests.
 *
 * Covers the enable→disable lifecycle (idempotent add/remove), preservation of
 * unrelated PreToolUse entries AND unrelated hook events (SessionStart /
 * StopFailure that generateHookSettings writes), plus the filesystem
 * robustness contract (missing file, malformed JSON) shared with
 * mergeThinkingIntoSettings.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildExitPlanAutoApproveSettings,
  mergeExitPlanAutoApproveIntoSettings,
  exitPlanHookCommand,
  EXIT_PLAN_HOOK_SCRIPT,
} from "./mergeExitPlanAutoApproveIntoSettings";

/** Shape of a PreToolUse entry array element, narrowed for assertions. */
type PreEntry = {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
};

function preToolUse(obj: Record<string, unknown>): PreEntry[] {
  const hooks = obj.hooks as Record<string, unknown> | undefined;
  return (hooks?.PreToolUse as PreEntry[]) ?? [];
}

describe("buildExitPlanAutoApproveSettings", () => {
  it("adds an ExitPlanMode PreToolUse entry when enabled", () => {
    const out = buildExitPlanAutoApproveSettings({}, true);
    const entries = preToolUse(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe("ExitPlanMode");
    expect(entries[0].hooks?.[0]).toEqual({
      type: "command",
      command: exitPlanHookCommand(),
    });
  });

  it("omits PreToolUse entirely when disabled and nothing else is present", () => {
    const out = buildExitPlanAutoApproveSettings({}, false);
    expect((out.hooks as Record<string, unknown>).PreToolUse).toBeUndefined();
  });

  it("is idempotent: enabling twice yields exactly one entry", () => {
    const once = buildExitPlanAutoApproveSettings({}, true);
    const twice = buildExitPlanAutoApproveSettings(once, true);
    const entries = preToolUse(twice).filter((e) =>
      e.hooks?.some((h) => h.command?.includes(EXIT_PLAN_HOOK_SCRIPT)),
    );
    expect(entries).toHaveLength(1);
  });

  it("enable→disable converges back to no PreToolUse", () => {
    const enabled = buildExitPlanAutoApproveSettings({}, true);
    const disabled = buildExitPlanAutoApproveSettings(enabled, false);
    expect(
      (disabled.hooks as Record<string, unknown>).PreToolUse,
    ).toBeUndefined();
  });

  it("preserves unrelated PreToolUse entries when enabling", () => {
    const userEntry = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo guard" }],
    };
    const out = buildExitPlanAutoApproveSettings(
      { hooks: { PreToolUse: [userEntry] } },
      true,
    );
    const entries = preToolUse(out);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(userEntry);
    expect(entries.some((e) => e.matcher === "ExitPlanMode")).toBe(true);
  });

  it("preserves unrelated PreToolUse entries when disabling (removes only ours)", () => {
    const userEntry = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo guard" }],
    };
    const enabled = buildExitPlanAutoApproveSettings(
      { hooks: { PreToolUse: [userEntry] } },
      true,
    );
    const disabled = buildExitPlanAutoApproveSettings(enabled, false);
    const entries = preToolUse(disabled);
    expect(entries).toEqual([userEntry]);
  });

  it("preserves unrelated hook events (SessionStart / StopFailure)", () => {
    const base = {
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [] }],
        StopFailure: [{ matcher: "*", hooks: [] }],
      },
    };
    const enabled = buildExitPlanAutoApproveSettings(base, true);
    const hooks = enabled.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toEqual(base.hooks.SessionStart);
    expect(hooks.StopFailure).toEqual(base.hooks.StopFailure);

    const disabled = buildExitPlanAutoApproveSettings(enabled, false);
    const dHooks = disabled.hooks as Record<string, unknown>;
    expect(dHooks.SessionStart).toEqual(base.hooks.SessionStart);
    expect(dHooks.StopFailure).toEqual(base.hooks.StopFailure);
  });

  it("preserves unrelated top-level settings keys", () => {
    const out = buildExitPlanAutoApproveSettings(
      { alwaysThinkingEnabled: true, env: { FOO: "bar" } },
      true,
    );
    expect(out.alwaysThinkingEnabled).toBe(true);
    expect(out.env).toEqual({ FOO: "bar" });
  });
});

describe("mergeExitPlanAutoApproveIntoSettings (filesystem)", () => {
  let dir: string;
  let filepath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exitplan-settings-"));
    filepath = join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the hook into an existing settings file when enabled", () => {
    writeFileSync(filepath, JSON.stringify({ hooks: { SessionStart: [] } }));
    mergeExitPlanAutoApproveIntoSettings(filepath, true);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
    expect(after.hooks.SessionStart).toEqual([]);
  });

  it("removes the hook when disabled across a cold restart", () => {
    mergeExitPlanAutoApproveIntoSettings(filepath, true);
    mergeExitPlanAutoApproveIntoSettings(filepath, false);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after.hooks.PreToolUse).toBeUndefined();
  });

  it("converges on repeated enable calls (no duplicate entries)", () => {
    mergeExitPlanAutoApproveIntoSettings(filepath, true);
    mergeExitPlanAutoApproveIntoSettings(filepath, true);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
  });

  it("tolerates a missing settings file", () => {
    expect(() =>
      mergeExitPlanAutoApproveIntoSettings(filepath, true),
    ).not.toThrow();
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
  });

  it("tolerates malformed JSON without crashing or clobbering", () => {
    writeFileSync(filepath, "{not valid");
    expect(() =>
      mergeExitPlanAutoApproveIntoSettings(filepath, true),
    ).not.toThrow();
    // Parse failure leaves the original file untouched.
    expect(readFileSync(filepath, "utf-8")).toBe("{not valid");
  });
});
