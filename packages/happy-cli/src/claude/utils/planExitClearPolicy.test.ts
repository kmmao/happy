import { describe, expect, it } from "vitest";

import {
  parseKeepContextEnv,
  shouldClearOnPlanExit,
} from "./planExitClearPolicy";

describe("shouldClearOnPlanExit", () => {
  it("clears when the user explicitly picked 'Clear context & execute'", () => {
    // Explicit click always wins, regardless of mode or env.
    expect(
      shouldClearOnPlanExit({
        explicitClear: true,
        bypass: false,
        keepContextEnv: false,
      }),
    ).toBe(true);
  });

  it("explicit clear overrides HAPPY_PLAN_KEEP_CONTEXT", () => {
    expect(
      shouldClearOnPlanExit({
        explicitClear: true,
        bypass: true,
        keepContextEnv: true,
      }),
    ).toBe(true);
  });

  it("defaults to clear for a bypass session (the 429 hot path)", () => {
    // The core fix: plain "Approve plan" in bypass no longer bursts.
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: true,
        keepContextEnv: false,
      }),
    ).toBe(true);
  });

  it("keeps classic continuation when bypass user opts out via env", () => {
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: true,
        keepContextEnv: true,
      }),
    ).toBe(false);
  });

  it("keeps classic continuation for non-bypass sessions", () => {
    // No lockdown, context continuity matters more, and these rarely
    // 429 — leave them on the full-context path.
    expect(
      shouldClearOnPlanExit({
        explicitClear: false,
        bypass: false,
        keepContextEnv: false,
      }),
    ).toBe(false);
  });
});

describe("parseKeepContextEnv", () => {
  it("treats 1 / true (any case) as opt-out", () => {
    expect(parseKeepContextEnv("1")).toBe(true);
    expect(parseKeepContextEnv("true")).toBe(true);
    expect(parseKeepContextEnv("TRUE")).toBe(true);
    expect(parseKeepContextEnv("  true  ")).toBe(true);
  });

  it("treats unset / empty / anything else as not opted out (clear stays on)", () => {
    expect(parseKeepContextEnv(undefined)).toBe(false);
    expect(parseKeepContextEnv("")).toBe(false);
    expect(parseKeepContextEnv("0")).toBe(false);
    expect(parseKeepContextEnv("false")).toBe(false);
    expect(parseKeepContextEnv("yes")).toBe(false);
  });
});
