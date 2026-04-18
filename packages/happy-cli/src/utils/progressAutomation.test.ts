import { describe, expect, it } from "vitest";
import {
  buildAutoProgressSyntheticPrompt,
  buildAutoSummarySyntheticPrompt,
  didChecklistTransitionToCompleted,
  HAPPY_AUTO_PROGRESS_SOURCE,
  HAPPY_AUTO_SUMMARY_SOURCE,
  isHappyAutomationSource,
  isHappyProgressToolName,
  isHappySummaryToolName,
  shouldTriggerCodexAutoProgress,
} from "./progressAutomation";

describe("progressAutomation", () => {
  it("detects checklist completion transitions once", () => {
    expect(
      didChecklistTransitionToCompleted({
        priorTodos: [
          { status: "completed" },
          { status: "in_progress" },
        ],
        nextTodos: [
          { status: "completed" },
          { status: "completed" },
        ],
        alreadyGenerated: false,
      }),
    ).toBe(true);

    expect(
      didChecklistTransitionToCompleted({
        priorTodos: [
          { status: "completed" },
          { status: "in_progress" },
        ],
        nextTodos: [
          { status: "completed" },
          { status: "completed" },
        ],
        alreadyGenerated: true,
      }),
    ).toBe(false);
  });

  it("detects happy MCP tool names across naming styles", () => {
    expect(isHappyProgressToolName("mcp__happy__update_progress")).toBe(true);
    expect(isHappyProgressToolName("happy__update_progress")).toBe(true);
    expect(isHappySummaryToolName("mcp__happy__update_session_summary")).toBe(
      true,
    );
    expect(isHappySummaryToolName("update_session_summary")).toBe(true);
    expect(isHappyProgressToolName("CodexPatch")).toBe(false);
  });

  it("treats hidden automation turns as automation sources", () => {
    expect(isHappyAutomationSource(HAPPY_AUTO_PROGRESS_SOURCE)).toBe(true);
    expect(isHappyAutomationSource(HAPPY_AUTO_SUMMARY_SOURCE)).toBe(true);
    expect(isHappyAutomationSource("ios")).toBe(false);
  });

  it("triggers codex auto-progress only for meaningful non-automation turns", () => {
    expect(
      shouldTriggerCodexAutoProgress({
        source: "ios",
        sawPlanUpdate: true,
        sawFileChanges: false,
        sawDiffUpdate: false,
        wroteProgress: false,
      }),
    ).toBe(true);

    expect(
      shouldTriggerCodexAutoProgress({
        source: HAPPY_AUTO_PROGRESS_SOURCE,
        sawPlanUpdate: true,
        sawFileChanges: true,
        sawDiffUpdate: true,
        wroteProgress: false,
      }),
    ).toBe(false);

    expect(
      shouldTriggerCodexAutoProgress({
        source: "web",
        sawPlanUpdate: false,
        sawFileChanges: true,
        sawDiffUpdate: true,
        wroteProgress: true,
      }),
    ).toBe(false);
  });

  it("builds non-empty synthetic prompts", () => {
    expect(buildAutoProgressSyntheticPrompt()).toContain(
      "mcp__happy__update_progress",
    );
    expect(buildAutoSummarySyntheticPrompt()).toContain(
      "mcp__happy__update_session_summary",
    );
  });
});
