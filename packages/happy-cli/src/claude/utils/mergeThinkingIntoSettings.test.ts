/**
 * mergeThinkingIntoSettings — patch-shape tests.
 *
 * These cover the three meaningful inputs (undefined / adaptive / enabled)
 * plus the merge semantics (existing env keys must survive the patch).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeThinkingIntoSettings } from "./mergeThinkingIntoSettings";

describe("mergeThinkingIntoSettings", () => {
  let dir: string;
  let filepath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "thinking-settings-"));
    filepath = join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op when thinking is undefined", () => {
    writeFileSync(filepath, JSON.stringify({ hooks: { SessionStart: [] } }));
    mergeThinkingIntoSettings(filepath, undefined);
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after).toEqual({ hooks: { SessionStart: [] } });
  });

  it("is a no-op when thinking.type is adaptive", () => {
    writeFileSync(filepath, JSON.stringify({ hooks: { SessionStart: [] } }));
    mergeThinkingIntoSettings(filepath, { type: "adaptive" });
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after).toEqual({ hooks: { SessionStart: [] } });
  });

  it("writes alwaysThinkingEnabled and adaptive-thinking env when enabled", () => {
    writeFileSync(filepath, JSON.stringify({ hooks: { SessionStart: [] } }));
    mergeThinkingIntoSettings(filepath, { type: "enabled", budgetTokens: 5000 });
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after.alwaysThinkingEnabled).toBe(true);
    expect(after.env).toEqual({ CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" });
    // Pre-existing keys survive.
    expect(after.hooks).toEqual({ SessionStart: [] });
  });

  it("preserves unrelated env keys when merging", () => {
    writeFileSync(
      filepath,
      JSON.stringify({
        env: { FOO: "bar", CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "0" },
      }),
    );
    mergeThinkingIntoSettings(filepath, { type: "enabled" });
    const after = JSON.parse(readFileSync(filepath, "utf-8"));
    expect(after.env).toEqual({
      FOO: "bar",
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1", // overwritten
    });
  });

  it("tolerates a missing settings file", () => {
    // File does not exist yet — should not throw.
    expect(() =>
      mergeThinkingIntoSettings(filepath, { type: "enabled" }),
    ).not.toThrow();
  });

  it("tolerates malformed JSON without crashing", () => {
    writeFileSync(filepath, "{not valid");
    expect(() =>
      mergeThinkingIntoSettings(filepath, { type: "enabled" }),
    ).not.toThrow();
    // The original file is left untouched on parse failure.
    expect(readFileSync(filepath, "utf-8")).toBe("{not valid");
  });
});
