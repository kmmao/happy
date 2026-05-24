/**
 * disallowedTools — tests for the pure helper that builds the PTY-mode
 * `--disallowedTools` flag list.
 *
 * Coverage focus:
 *  1. AskUserQuestion is invariantly present (PTY-mode hang protection).
 *  2. plan-mode lockdown adds the write/exec tool family and nothing else.
 *  3. caller's base list is preserved + deduplicated against the invariants.
 *  4. lockdown ↔ no-lockdown produces different result shapes (so the
 *     launcher's cold-restart hash actually flips when the flag toggles).
 */

import { describe, it, expect } from "vitest";
import {
  buildPtyDisallowedTools,
  PLAN_LOCKDOWN_DISALLOWED_TOOLS,
} from "./disallowedTools";

describe("buildPtyDisallowedTools", () => {
  it("always denies AskUserQuestion (PTY mode has no return channel)", () => {
    expect(buildPtyDisallowedTools({})).toContain("AskUserQuestion");
    expect(buildPtyDisallowedTools({ base: [] })).toContain("AskUserQuestion");
    expect(
      buildPtyDisallowedTools({ base: ["SomeOther"] }),
    ).toContain("AskUserQuestion");
  });

  it("returns ONLY AskUserQuestion when no base + no lockdown", () => {
    expect(buildPtyDisallowedTools({})).toEqual(["AskUserQuestion"]);
  });

  it("appends the plan-lockdown tool set when planModeLockdown=true", () => {
    const result = buildPtyDisallowedTools({ planModeLockdown: true });
    expect(result).toContain("AskUserQuestion");
    for (const tool of PLAN_LOCKDOWN_DISALLOWED_TOOLS) {
      expect(result).toContain(tool);
    }
  });

  it("omits the plan-lockdown tool set when planModeLockdown=false", () => {
    const result = buildPtyDisallowedTools({ planModeLockdown: false });
    for (const tool of PLAN_LOCKDOWN_DISALLOWED_TOOLS) {
      expect(result).not.toContain(tool);
    }
  });

  it("treats undefined planModeLockdown the same as false", () => {
    expect(buildPtyDisallowedTools({})).toEqual(
      buildPtyDisallowedTools({ planModeLockdown: false }),
    );
  });

  it("preserves caller-supplied base entries", () => {
    const result = buildPtyDisallowedTools({
      base: ["MyCustomTool", "AnotherTool"],
    });
    expect(result).toContain("MyCustomTool");
    expect(result).toContain("AnotherTool");
  });

  it("deduplicates when base already contains AskUserQuestion", () => {
    const result = buildPtyDisallowedTools({
      base: ["AskUserQuestion", "AskUserQuestion", "X"],
    });
    expect(result.filter((t) => t === "AskUserQuestion")).toHaveLength(1);
    expect(result).toContain("X");
  });

  it("deduplicates when base overlaps the lockdown set", () => {
    const result = buildPtyDisallowedTools({
      base: ["Write", "Bash"],
      planModeLockdown: true,
    });
    expect(result.filter((t) => t === "Write")).toHaveLength(1);
    expect(result.filter((t) => t === "Bash")).toHaveLength(1);
  });

  it("returns a different shape when lockdown toggles (drives cold restart)", () => {
    // The launcher's coldModeHash includes planLockdown, but the deny list
    // is what `--disallowedTools` actually carries to the spawned process.
    // If these two shapes ever became equal we'd silently lose the lockdown.
    const off = buildPtyDisallowedTools({ planModeLockdown: false });
    const on = buildPtyDisallowedTools({ planModeLockdown: true });
    expect(new Set(off)).not.toEqual(new Set(on));
    expect(on.length).toBeGreaterThan(off.length);
  });

  it("does NOT deny read-only tools even during lockdown", () => {
    // Plan mode is meant to keep investigative tools available; only the
    // write/exec family is blocked. If this list ever drifts the model
    // loses the ability to explore the codebase during planning.
    const result = buildPtyDisallowedTools({ planModeLockdown: true });
    for (const readOnly of ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]) {
      expect(result).not.toContain(readOnly);
    }
  });
});
