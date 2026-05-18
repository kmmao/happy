import { describe, it, expect } from "vitest";
import {
  buildFlagSettingsPatch,
  describePatch,
  type FlagSettingsPatch,
} from "./flagSettingsPatch";
import type { EnhancedMode } from "@/claude/loop";

function makeMode(overrides: Partial<EnhancedMode> = {}): EnhancedMode {
  return {
    permissionMode: "default",
    ...overrides,
  };
}

describe("buildFlagSettingsPatch", () => {
  it("returns null when modes are identical", () => {
    const mode = makeMode({ allowedTools: ["Read"], disallowedTools: ["Write"] });
    expect(buildFlagSettingsPatch(mode, mode)).toBeNull();
  });

  it("returns null when both have no tools", () => {
    const prev = makeMode();
    const next = makeMode();
    expect(buildFlagSettingsPatch(prev, next)).toBeNull();
  });

  it("detects allowedTools addition", () => {
    const prev = makeMode({ allowedTools: [] });
    const next = makeMode({ allowedTools: ["Bash(*)"] });
    const patch = buildFlagSettingsPatch(prev, next);
    expect(patch).toEqual({
      permissions: { allow: ["Bash(*)"] },
    });
  });

  it("detects allowedTools removal", () => {
    const prev = makeMode({ allowedTools: ["Bash(*)", "Read"] });
    const next = makeMode({ allowedTools: ["Read"] });
    const patch = buildFlagSettingsPatch(prev, next);
    expect(patch).toEqual({
      permissions: { allow: ["Read"] },
    });
  });

  it("detects disallowedTools change", () => {
    const prev = makeMode({ disallowedTools: ["Write"] });
    const next = makeMode({ disallowedTools: ["Write", "Edit"] });
    const patch = buildFlagSettingsPatch(prev, next);
    expect(patch).toEqual({
      permissions: { deny: ["Write", "Edit"] },
    });
  });

  it("detects both allow and deny changes simultaneously", () => {
    const prev = makeMode({ allowedTools: ["Read"], disallowedTools: ["Write"] });
    const next = makeMode({ allowedTools: ["Read", "Bash(*)"], disallowedTools: [] });
    const patch = buildFlagSettingsPatch(prev, next);
    expect(patch).toEqual({
      permissions: {
        allow: ["Read", "Bash(*)"],
        deny: [],
      },
    });
  });

  it("treats undefined as empty array (normalized)", () => {
    const prev = makeMode({ allowedTools: undefined });
    const next = makeMode({ allowedTools: [] });
    // undefined → [] and [] → [] are equal
    expect(buildFlagSettingsPatch(prev, next)).toBeNull();
  });

  it("detects change from undefined to non-empty", () => {
    const prev = makeMode({ allowedTools: undefined });
    const next = makeMode({ allowedTools: ["Read"] });
    const patch = buildFlagSettingsPatch(prev, next);
    expect(patch).toEqual({
      permissions: { allow: ["Read"] },
    });
  });

  it("is order-sensitive", () => {
    const prev = makeMode({ allowedTools: ["Read", "Write"] });
    const next = makeMode({ allowedTools: ["Write", "Read"] });
    const patch = buildFlagSettingsPatch(prev, next);
    // Order changed → treated as different
    expect(patch).not.toBeNull();
    expect(patch!.permissions!.allow).toEqual(["Write", "Read"]);
  });

  it("ignores non-Settings fields (model, thinking, effort)", () => {
    const prev = makeMode({ model: "opus", thinking: { type: "enabled", budgetTokens: 1024 } });
    const next = makeMode({ model: "sonnet", thinking: { type: "disabled" } });
    // model/thinking are Options-level, not Settings-level → no patch
    expect(buildFlagSettingsPatch(prev, next)).toBeNull();
  });
});

describe("describePatch", () => {
  it("describes permissions patch", () => {
    const patch: FlagSettingsPatch = {
      permissions: { allow: ["Bash(*)", "Read"], deny: ["Write"] },
    };
    expect(describePatch(patch)).toBe("permissions(allow[2],deny[1])");
  });

  it("describes model patch", () => {
    const patch: FlagSettingsPatch = { model: "opus" };
    expect(describePatch(patch)).toBe("model(opus)");
  });

  it("describes null model", () => {
    const patch: FlagSettingsPatch = { model: null };
    expect(describePatch(patch)).toBe("model(null)");
  });

  it("describes empty patch", () => {
    expect(describePatch({})).toBe("(empty)");
  });

  it("describes combined patch", () => {
    const patch: FlagSettingsPatch = {
      permissions: { allow: ["Read"] },
      model: "sonnet",
    };
    expect(describePatch(patch)).toBe("permissions(allow[1]), model(sonnet)");
  });
});
