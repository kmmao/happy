/**
 * mergeExitPlanAutoApproveIntoSettings — patch-shape tests.
 *
 * Covers the three-way ExitPlanHookMode lifecycle (`"none"` ↔
 * `"auto-approve"` ↔ `"app-picker"`), idempotent add/remove, preservation
 * of unrelated PreToolUse entries AND unrelated hook events (SessionStart /
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
  exitPlanHookEntry,
  EXIT_PLAN_HOOK_SCRIPT,
  EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT,
} from "./mergeExitPlanAutoApproveIntoSettings";

/** Shape of a PreToolUse entry array element, narrowed for assertions. */
type PreEntry = {
  matcher?: string;
  hooks?: { type?: string; command?: string; args?: unknown[] }[];
};

function preToolUse(obj: Record<string, unknown>): PreEntry[] {
  const hooks = obj.hooks as Record<string, unknown> | undefined;
  return (hooks?.PreToolUse as PreEntry[]) ?? [];
}

// Any nonzero, in-range port — the value itself is only asserted for the
// app-picker variant; the auto-approve variant ignores it (script takes no
// port argv). Using a literal keeps expectations stable across test runs.
const PORT = 65432;

describe("buildExitPlanAutoApproveSettings", () => {
  it("adds an ExitPlanMode PreToolUse entry pointing at auto-approve when mode='auto-approve'", () => {
    const out = buildExitPlanAutoApproveSettings({}, "auto-approve", PORT);
    const entries = preToolUse(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe("ExitPlanMode");
    expect(entries[0].hooks?.[0]).toEqual(
      exitPlanHookEntry("auto-approve", PORT),
    );
    // Auto-approve script takes no port argv.
    expect(entries[0].hooks?.[0].args).toEqual([
      expect.stringContaining(EXIT_PLAN_HOOK_SCRIPT),
    ]);
  });

  it("adds an ExitPlanMode PreToolUse entry pointing at the forwarder when mode='app-picker'", () => {
    const out = buildExitPlanAutoApproveSettings({}, "app-picker", PORT);
    const entries = preToolUse(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe("ExitPlanMode");
    // Forwarder script MUST get the hookServer port as the second argv —
    // it needs it to POST the picker payload back to us.
    expect(entries[0].hooks?.[0].args).toEqual([
      expect.stringContaining(EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT),
      String(PORT),
    ]);
  });

  it("omits PreToolUse entirely when mode='none' and nothing else is present", () => {
    const out = buildExitPlanAutoApproveSettings({}, "none", PORT);
    expect((out.hooks as Record<string, unknown>).PreToolUse).toBeUndefined();
  });

  it("is idempotent: repeating the same mode yields exactly one entry", () => {
    const once = buildExitPlanAutoApproveSettings({}, "auto-approve", PORT);
    const twice = buildExitPlanAutoApproveSettings(once, "auto-approve", PORT);
    const entries = preToolUse(twice).filter((e) =>
      e.hooks?.some((h) => {
        const argsStr = (h.args ?? []).join(" ");
        return argsStr.includes(EXIT_PLAN_HOOK_SCRIPT);
      }),
    );
    expect(entries).toHaveLength(1);
  });

  it("toggles cleanly from auto-approve → app-picker (strips the stale entry)", () => {
    const first = buildExitPlanAutoApproveSettings({}, "auto-approve", PORT);
    const second = buildExitPlanAutoApproveSettings(first, "app-picker", PORT);
    const entries = preToolUse(second);
    expect(entries).toHaveLength(1);
    const argsStr = (entries[0].hooks?.[0].args ?? []).join(" ");
    expect(argsStr).toContain(EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT);
    expect(argsStr).not.toContain(EXIT_PLAN_HOOK_SCRIPT + " "); // ensure not both
  });

  it("toggles cleanly from app-picker → auto-approve (strips the stale entry)", () => {
    const first = buildExitPlanAutoApproveSettings({}, "app-picker", PORT);
    const second = buildExitPlanAutoApproveSettings(
      first,
      "auto-approve",
      PORT,
    );
    const entries = preToolUse(second);
    expect(entries).toHaveLength(1);
    const argsStr = (entries[0].hooks?.[0].args ?? []).join(" ");
    expect(argsStr).toContain(EXIT_PLAN_HOOK_SCRIPT);
    expect(argsStr).not.toContain(EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT);
  });

  it("any-mode → none converges back to no PreToolUse", () => {
    for (const initial of ["auto-approve", "app-picker"] as const) {
      const enabled = buildExitPlanAutoApproveSettings({}, initial, PORT);
      const disabled = buildExitPlanAutoApproveSettings(enabled, "none", PORT);
      expect(
        (disabled.hooks as Record<string, unknown>).PreToolUse,
      ).toBeUndefined();
    }
  });

  it("preserves unrelated PreToolUse entries when injecting", () => {
    const userEntry = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo guard" }],
    };
    const out = buildExitPlanAutoApproveSettings(
      { hooks: { PreToolUse: [userEntry] } },
      "app-picker",
      PORT,
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
      "auto-approve",
      PORT,
    );
    const disabled = buildExitPlanAutoApproveSettings(enabled, "none", PORT);
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
    const enabled = buildExitPlanAutoApproveSettings(
      base,
      "app-picker",
      PORT,
    );
    const hooks = enabled.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toEqual(base.hooks.SessionStart);
    expect(hooks.StopFailure).toEqual(base.hooks.StopFailure);

    const disabled = buildExitPlanAutoApproveSettings(enabled, "none", PORT);
    const dHooks = disabled.hooks as Record<string, unknown>;
    expect(dHooks.SessionStart).toEqual(base.hooks.SessionStart);
    expect(dHooks.StopFailure).toEqual(base.hooks.StopFailure);
  });

  it("preserves unrelated top-level settings keys", () => {
    const out = buildExitPlanAutoApproveSettings(
      { alwaysThinkingEnabled: true, env: { FOO: "bar" } },
      "auto-approve",
      PORT,
    );
    expect(out.alwaysThinkingEnabled).toBe(true);
    expect(out.env).toEqual({ FOO: "bar" });
  });

  it("strips a legacy shell-form entry (command: 'node <path>' without args)", () => {
    // Older happy-cli builds injected the shell-form command. When a user
    // upgrades mid-session the file may still contain that shape. The
    // migration path must find and strip it before appending the new
    // exec-form entry, otherwise the TUI runs both hooks in parallel.
    const legacy = {
      hooks: {
        PreToolUse: [
          {
            matcher: "ExitPlanMode",
            hooks: [
              {
                type: "command",
                command: `node "/abs/path/to/${EXIT_PLAN_HOOK_SCRIPT}"`,
              },
            ],
          },
        ],
      },
    };
    const out = buildExitPlanAutoApproveSettings(legacy, "app-picker", PORT);
    const entries = preToolUse(out);
    expect(entries).toHaveLength(1);
    const argsStr = (entries[0].hooks?.[0].args ?? []).join(" ");
    expect(argsStr).toContain(EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT);
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

  it("writes the hook into an existing settings file when injecting", () => {
    writeFileSync(filepath, JSON.stringify({ hooks: { SessionStart: [] } }));
    mergeExitPlanAutoApproveIntoSettings(filepath, "app-picker", PORT);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
    expect(after.hooks.SessionStart).toEqual([]);
  });

  it("removes the hook when set to 'none' across a cold restart", () => {
    mergeExitPlanAutoApproveIntoSettings(filepath, "auto-approve", PORT);
    mergeExitPlanAutoApproveIntoSettings(filepath, "none", PORT);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after.hooks.PreToolUse).toBeUndefined();
  });

  it("converges on repeated same-mode calls (no duplicate entries)", () => {
    mergeExitPlanAutoApproveIntoSettings(filepath, "app-picker", PORT);
    mergeExitPlanAutoApproveIntoSettings(filepath, "app-picker", PORT);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
  });

  it("tolerates a missing settings file", () => {
    expect(() =>
      mergeExitPlanAutoApproveIntoSettings(filepath, "app-picker", PORT),
    ).not.toThrow();
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(preToolUse(after)).toHaveLength(1);
  });

  it("tolerates malformed JSON without crashing or clobbering", () => {
    writeFileSync(filepath, "{not valid");
    expect(() =>
      mergeExitPlanAutoApproveIntoSettings(filepath, "app-picker", PORT),
    ).not.toThrow();
    // Parse failure leaves the original file untouched.
    expect(readFileSync(filepath, "utf-8")).toBe("{not valid");
  });
});
