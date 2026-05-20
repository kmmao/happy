import { describe, it, expect, vi } from "vitest";
import {
  applyFlagSettings,
  applyFlagSettingsFromModeDiff,
  createAppliedSettingsState,
  type _AppliedSettingsState,
} from "./applyFlagSettings";
import type { EnhancedMode } from "@/claude/loop";

// ─── Mock SDK Query ───────────────────────────────────────────────────────────

function makeMockQuery(opts?: { shouldThrow?: Error }) {
  return {
    applyFlagSettings: vi.fn().mockImplementation(async () => {
      if (opts?.shouldThrow) throw opts.shouldThrow;
    }),
  } as unknown as import("@anthropic-ai/claude-agent-sdk").Query;
}

function makeMode(overrides: Partial<EnhancedMode> = {}): EnhancedMode {
  return { permissionMode: "default", ...overrides };
}

// ─── applyFlagSettings ───────────────────────────────────────────────────────

describe("applyFlagSettings", () => {
  it("applies valid settings and tracks state", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettings(
      q,
      { model: "opus", permissions: { allow: ["Read"] } },
      state,
    );

    expect(result).toEqual({ applied: true, keys: ["model", "permissions"] });
    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      model: "opus",
      permissions: { allow: ["Read"] },
    });
    expect(state.applyCount).toBe(1);
    expect(state.lastAppliedAt).toBeGreaterThan(0);
    expect(state.current).toEqual({
      model: "opus",
      permissions: { allow: ["Read"] },
    });
  });

  it("skips empty settings", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettings(q, {}, state);

    expect(result).toEqual({ applied: false, reason: "empty" });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    expect(state.applyCount).toBe(0);
  });

  it("rejects invalid settings (blocked key)", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettings(
      q,
      { hooks: [{ command: "rm -rf /" }] },
      state,
    );

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("validation_error");
      expect(result.error).toMatch(/hooks/);
    }
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid settings (type mismatch)", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettings(q, { model: 42 }, state);

    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.reason).toBe("validation_error");
  });

  it("captures SDK errors without throwing", async () => {
    const q = makeMockQuery({ shouldThrow: new Error("SDK internal error") });
    const state = createAppliedSettingsState();

    const result = await applyFlagSettings(
      q,
      { model: "opus" },
      state,
    );

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("sdk_error");
      expect(result.error).toBe("SDK internal error");
    }
    // State should NOT be updated on failure
    expect(state.applyCount).toBe(0);
  });

  it("removes null keys from tracked state", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();
    state.current = { model: "opus", attribution: true };

    const result = await applyFlagSettings(q, { model: null }, state);

    expect(result).toEqual({ applied: true, keys: ["model"] });
    // model should be removed from tracked state
    expect(state.current).toEqual({ attribution: true });
  });

  it("accumulates multiple applies", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    await applyFlagSettings(q, { model: "opus" }, state);
    await applyFlagSettings(q, { attribution: true }, state);
    await applyFlagSettings(q, { model: "sonnet" }, state);

    expect(state.applyCount).toBe(3);
    expect(state.current).toEqual({ model: "sonnet", attribution: true });
  });
});

// ─── applyFlagSettingsFromModeDiff ────────────────────────────────────────────

describe("applyFlagSettingsFromModeDiff", () => {
  it("returns empty when no Settings-level diff", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettingsFromModeDiff(
      q,
      makeMode(),
      makeMode(),
      state,
    );

    expect(result).toEqual({ applied: false, reason: "empty" });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
  });

  it("applies permissions diff from mode change", async () => {
    const q = makeMockQuery();
    const state = createAppliedSettingsState();

    const result = await applyFlagSettingsFromModeDiff(
      q,
      makeMode({ allowedTools: [] }),
      makeMode({ allowedTools: ["Bash(*)"] }),
      state,
    );

    expect(result).toEqual({ applied: true, keys: ["permissions"] });
    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      permissions: { allow: ["Bash(*)"] },
    });
    expect(state.applyCount).toBe(1);
    expect(state.current.permissions).toEqual({ allow: ["Bash(*)"] });
  });

  it("captures SDK errors from mode diff path", async () => {
    const q = makeMockQuery({ shouldThrow: new Error("boom") });
    const state = createAppliedSettingsState();

    const result = await applyFlagSettingsFromModeDiff(
      q,
      makeMode({ disallowedTools: [] }),
      makeMode({ disallowedTools: ["Write"] }),
      state,
    );

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("sdk_error");
      expect(result.error).toBe("boom");
    }
    expect(state.applyCount).toBe(0);
  });
});

// ─── createAppliedSettingsState ───────────────────────────────────────────────

describe("createAppliedSettingsState", () => {
  it("starts with empty state", () => {
    const state = createAppliedSettingsState();
    expect(state.current).toEqual({});
    expect(state.applyCount).toBe(0);
    expect(state.lastAppliedAt).toBeNull();
  });
});
