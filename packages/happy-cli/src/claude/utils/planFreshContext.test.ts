import { describe, it, expect } from "vitest";

import { extractPlanBody } from "../runClaude";
import { buildPlanExecutionPrompt } from "../jsonl/prompts";

// Layer 0 ("Clear context & execute", see docs/investigations/plan-mode-429.md)
// pure helpers. extractPlanBody must be defensive — a missing/blank/non-string
// plan makes onExitPlanApproval fall back to the classic PLAN_FAKE_RESTART
// continue path, so an approval never regresses into an empty first turn.

describe("extractPlanBody", () => {
  it("returns the trimmed plan markdown from an ExitPlanMode tool input", () => {
    expect(extractPlanBody({ plan: "  # Do the thing\n\n- step 1  " })).toBe(
      "# Do the thing\n\n- step 1",
    );
  });

  it("returns undefined when plan is missing", () => {
    expect(extractPlanBody({})).toBeUndefined();
  });

  it("returns undefined when plan is blank / whitespace only", () => {
    expect(extractPlanBody({ plan: "   \n\t " })).toBeUndefined();
  });

  it("returns undefined for non-string plan values", () => {
    expect(extractPlanBody({ plan: 42 })).toBeUndefined();
    expect(extractPlanBody({ plan: { nested: true } })).toBeUndefined();
  });

  it("returns undefined for non-object inputs", () => {
    expect(extractPlanBody(undefined)).toBeUndefined();
    expect(extractPlanBody(null)).toBeUndefined();
    expect(extractPlanBody("just a string")).toBeUndefined();
  });
});

describe("buildPlanExecutionPrompt", () => {
  it("wraps the plan body in the execution instruction", () => {
    const prompt = buildPlanExecutionPrompt("# Plan\n- do X");
    expect(prompt).toContain("# Plan\n- do X");
    expect(prompt.startsWith("以下是已批准的计划")).toBe(true);
  });
});
