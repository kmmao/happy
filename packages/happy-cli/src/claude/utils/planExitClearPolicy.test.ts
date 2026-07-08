import { describe, expect, it } from "vitest";

import {
  parseDefaultClearEnv,
  shouldClearOnPlanExit,
} from "./planExitClearPolicy";

describe("shouldClearOnPlanExit", () => {
  it("clears when the user explicitly picked 'Clear context & execute'", () => {
    // Explicit click always wins, regardless of mode or env.
    expect(
      shouldClearOnPlanExit({
        explicitClear: true,
        bypass: false,
        defaultClearEnv: false,
      }),
    ).toBe(true);
  });

  it("explicit clear wins even without the opt-in env", () => {
    expect(
      shouldClearOnPlanExit({
        explicitClear: true,
        bypass: true,
        defaultClearEnv: false,
      }),
    ).toBe(true);
  });

  it("keeps full context for a plain bypass approval (default, reverted)", () => {
    // The revert: plain "Approve plan" in bypass keeps the whole context
    // instead of clearing (0.102.26 default undone).
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: true,
        defaultClearEnv: false,
      }),
    ).toBe(false);
  });

  it("clears for bypass when opted in via HAPPY_PLAN_DEFAULT_CLEAR", () => {
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: true,
        defaultClearEnv: true,
      }),
    ).toBe(true);
  });

  it("keeps classic continuation for non-bypass sessions even with the env set", () => {
    // The opt-in only lifts the bypass default; non-bypass stays full-context.
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: false,
        defaultClearEnv: true,
      }),
    ).toBe(false);
  });
});

describe("parseDefaultClearEnv", () => {
  it("treats 1 / true (any case) as opt-in", () => {
    expect(parseDefaultClearEnv("1")).toBe(true);
    expect(parseDefaultClearEnv("true")).toBe(true);
    expect(parseDefaultClearEnv("TRUE")).toBe(true);
    expect(parseDefaultClearEnv("  true  ")).toBe(true);
  });

  it("treats unset / empty / anything else as not opted in (keep full context)", () => {
    expect(parseDefaultClearEnv(undefined)).toBe(false);
    expect(parseDefaultClearEnv("")).toBe(false);
    expect(parseDefaultClearEnv("0")).toBe(false);
    expect(parseDefaultClearEnv("false")).toBe(false);
    expect(parseDefaultClearEnv("yes")).toBe(false);
  });
});
