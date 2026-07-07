import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readExitPlanApprovalTimeoutMs,
  shouldAutoApproveExitPlanInBypass,
} from "./exitPlanApproval";

// Coverage for the two env-var reads that gate the plan-mode 429 mitigation:
//
//   HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE  — opt-in back to auto-approve
//   HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS — override the 10-min wait ceiling
//
// Both are read strictly (canonical truthy tokens / integer regex) so that
// misconfiguration fails loud rather than silently keeping the old
// behaviour. These tests lock the acceptance boundary — any regression that
// widens the accepted grammar (e.g. reintroducing parseInt's numeric-prefix
// accept for the timeout) will surface here.

describe("shouldAutoApproveExitPlanInBypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when the env var is unset (new default = App picker)", () => {
    expect(shouldAutoApproveExitPlanInBypass()).toBe(false);
  });

  it("returns false when the env var is empty", () => {
    vi.stubEnv("HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE", "");
    expect(shouldAutoApproveExitPlanInBypass()).toBe(false);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["0", false],
    ["false", false],
    ["no", false],
    ["yes", false],
    ["auto", false],
    ["1 ", false], // trailing whitespace not accepted (safer default)
    ["2", false],
  ])("returns %j → %j (canonical opt-in tokens only)", (raw, expected) => {
    vi.stubEnv("HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE", raw);
    expect(shouldAutoApproveExitPlanInBypass()).toBe(expected);
  });
});

describe("readExitPlanApprovalTimeoutMs", () => {
  const DEFAULT_MS = 600_000; // 10 min
  const MIN_MS = 10_000;
  const MAX_MS = 3_600_000;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the 10-minute default when unset", () => {
    expect(readExitPlanApprovalTimeoutMs()).toBe(DEFAULT_MS);
  });

  it("returns the default for non-integer strings (rejects parseInt prefix accept)", () => {
    for (const bad of ["", "30s", "5.5", "-100", "0x10", "abc", " ", "30ms"]) {
      vi.stubEnv("HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS", bad);
      expect(readExitPlanApprovalTimeoutMs()).toBe(DEFAULT_MS);
    }
  });

  it("clamps below MIN_MS up", () => {
    vi.stubEnv("HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS", "500");
    expect(readExitPlanApprovalTimeoutMs()).toBe(MIN_MS);
  });

  it("clamps above MAX_MS down", () => {
    vi.stubEnv("HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS", "9999999999");
    expect(readExitPlanApprovalTimeoutMs()).toBe(MAX_MS);
  });

  it("passes valid in-range integers through unchanged", () => {
    for (const ok of ["10000", "60000", "600000", "3600000"]) {
      vi.stubEnv("HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS", ok);
      expect(readExitPlanApprovalTimeoutMs()).toBe(Number.parseInt(ok, 10));
    }
  });

  it("returns default for zero (no negative-or-zero infinite loop)", () => {
    vi.stubEnv("HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS", "0");
    expect(readExitPlanApprovalTimeoutMs()).toBe(DEFAULT_MS);
  });
});
