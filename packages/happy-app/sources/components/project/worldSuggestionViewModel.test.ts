import { describe, expect, it } from "vitest";
import {
  getSuggestionAcceptanceLabelKey,
  getSuggestionAutoAcceptOutcomeKey,
  getSuggestionAutoAcceptReasonKey,
  getSuggestionTypeLabelKey,
  getSuggestionTypeConfig,
  applySuggestionStatusUpdate,
  removeSuggestionOptimistically,
  restoreSuggestionAtIndex,
  shouldRefetchSuggestions,
  mergeFetchedSuggestions,
  mergeVisibleSuggestions,
  shouldShowSuggestionActions,
  groupSuggestionsByBucket,
  getSuggestionPayloadTitle,
  type SuggestionLike,
} from "./worldSuggestionViewModel";
import type { SuggestionBucket, SuggestionSummary, SuggestionType } from "@/sync/apiWorld";

function createSuggestion(overrides: Partial<SuggestionSummary>): SuggestionSummary {
  return {
    id: "sug-1",
    projectId: "proj-1",
    relatedGoalId: null,
    relatedTaskId: null,
    type: "suggested_task",
    title: "Fallback title",
    summary: "summary",
    reason: "reason",
    evidence: [],
    recommendedRole: null,
    payload: {
      task: {
        title: "Task title",
        prompt: "Task prompt",
        priority: "user",
      },
    },
    requiresHuman: true,
    status: "open",
    dedupeKey: "dedupe:1",
    bucket: "next_step",
    createdAt: 1,
    actedAt: null,
    acceptSource: null,
    acceptAudit: null,
    autoAcceptStatus: null,
    autoAcceptReasonCode: null,
    ...overrides,
  } as SuggestionSummary;
}

describe("getSuggestionPayloadTitle", () => {
  it("returns task title from task suggestion payload", () => {
    expect(getSuggestionPayloadTitle(createSuggestion({
      type: "suggested_task",
      payload: {
        task: { title: "Fix build", prompt: "Investigate", priority: "user" },
      },
    }))).toBe("Fix build");
  });

  it("returns decision question from decision suggestion payload", () => {
    expect(getSuggestionPayloadTitle(createSuggestion({
      type: "suggested_decision",
      title: "Fallback title",
      payload: {
        decision: {
          question: "What next?",
          options: [
            { id: "a", description: "A" },
            { id: "b", description: "B" },
          ],
        },
      },
    }))).toBe("What next?");
  });
});

describe("getSuggestionTypeLabelKey", () => {
  it("returns decision label key for suggested_decision", () => {
    expect(getSuggestionTypeLabelKey("suggested_decision")).toBe("suggestions.typeDecision");
  });

  it("keeps runtime fallback for unexpected type input", () => {
    expect(getSuggestionTypeLabelKey("unknown_type" as unknown as SuggestionType)).toBe("suggestions.typeTask");
  });
});

describe("getSuggestionAcceptanceLabelKey", () => {
  it("returns manual accepted label for accepted human suggestions", () => {
    expect(getSuggestionAcceptanceLabelKey(createSuggestion({
      status: "accepted",
      acceptSource: "human",
    }))).toBe("suggestions.acceptedManual");
  });

  it("returns auto accepted label for accepted system suggestions", () => {
    expect(getSuggestionAcceptanceLabelKey(createSuggestion({
      status: "accepted",
      acceptSource: "system_auto",
    }))).toBe("suggestions.acceptedAuto");
  });

  it("returns generic accepted label for accepted legacy suggestions", () => {
    expect(getSuggestionAcceptanceLabelKey(createSuggestion({
      status: "accepted",
      acceptSource: null,
    }))).toBe("suggestions.acceptedGeneric");
  });

  it("returns null for non-accepted suggestions", () => {
    expect(getSuggestionAcceptanceLabelKey(createSuggestion({
      status: "open",
      acceptSource: "system_auto",
    }))).toBe(null);
  });
});

describe("getSuggestionAutoAcceptReasonKey", () => {
  it("returns safe-task reason key for accepted system suggestions with known audit rule", () => {
    expect(getSuggestionAutoAcceptReasonKey(createSuggestion({
      status: "accepted",
      acceptSource: "system_auto",
      acceptAudit: {
        rule: "safe_suggested_task_auto_accept",
        checks: ["type:suggested_task"],
      },
    }))).toBe("suggestions.autoAcceptReasonSafeTask");
  });

  it("returns null for human accepted suggestions", () => {
    expect(getSuggestionAutoAcceptReasonKey(createSuggestion({
      status: "accepted",
      acceptSource: "human",
      acceptAudit: {
        rule: "safe_suggested_task_auto_accept",
        checks: ["type:suggested_task"],
      },
    }))).toBe(null);
  });

  it("returns null when auto-accept audit is missing", () => {
    expect(getSuggestionAutoAcceptReasonKey(createSuggestion({
      status: "accepted",
      acceptSource: "system_auto",
      acceptAudit: null,
    }))).toBe(null);
  });

  it("returns null for non-accepted suggestions", () => {
    expect(getSuggestionAutoAcceptReasonKey(createSuggestion({
      status: "open",
      acceptSource: "system_auto",
      acceptAudit: {
        rule: "safe_suggested_task_auto_accept",
        checks: ["type:suggested_task"],
      },
    }))).toBe(null);
  });
});

describe("getSuggestionAutoAcceptOutcomeKey", () => {
  it("returns skipped quota key for skipped suggestions with quota reason", () => {
    expect(getSuggestionAutoAcceptOutcomeKey(createSuggestion({
      status: "open",
      autoAcceptStatus: "skipped",
      autoAcceptReasonCode: "quota_exhausted",
    }))).toBe("suggestions.autoAcceptSkippedQuota");
  });

  it("returns skipped already-acted key for skipped suggestions with race reason", () => {
    expect(getSuggestionAutoAcceptOutcomeKey(createSuggestion({
      status: "open",
      autoAcceptStatus: "skipped",
      autoAcceptReasonCode: "already_acted",
    }))).toBe("suggestions.autoAcceptSkippedAlreadyActed");
  });

  it("returns failed key for failed suggestions with accept failure reason", () => {
    expect(getSuggestionAutoAcceptOutcomeKey(createSuggestion({
      status: "open",
      autoAcceptStatus: "failed",
      autoAcceptReasonCode: "accept_failed",
    }))).toBe("suggestions.autoAcceptFailed");
  });

  it("returns null when no tracked auto-accept outcome is present", () => {
    expect(getSuggestionAutoAcceptOutcomeKey(createSuggestion({
      status: "accepted",
      acceptSource: "system_auto",
      autoAcceptStatus: null,
      autoAcceptReasonCode: null,
    }))).toBe(null);
  });
});

describe("shouldShowSuggestionActions", () => {
  it("shows actions for open suggestions", () => {
    expect(shouldShowSuggestionActions(createSuggestion({ status: "open" }))).toBe(true);
  });

  it("hides actions for accepted suggestions", () => {
    expect(shouldShowSuggestionActions(createSuggestion({ status: "accepted" }))).toBe(false);
  });
});

describe("mergeVisibleSuggestions", () => {
  it("combines open and accepted suggestions in descending createdAt order", () => {
    const result = mergeVisibleSuggestions(
      [createSuggestion({ id: "open-1", status: "open", createdAt: 2 })],
      [createSuggestion({ id: "accepted-1", status: "accepted", createdAt: 3 })],
    );

    expect(result.map((item) => item.id)).toEqual(["accepted-1", "open-1"]);
  });

  it("keeps only one copy when the same suggestion appears twice", () => {
    const result = mergeVisibleSuggestions(
      [createSuggestion({ id: "sug-1", status: "open", createdAt: 2 })],
      [createSuggestion({ id: "sug-1", status: "accepted", createdAt: 1, acceptSource: "system_auto" })],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "sug-1", status: "open" });
  });
});

describe("getSuggestionTypeConfig", () => {
  it("returns dedicated decision icon and color", () => {
    expect(getSuggestionTypeConfig("suggested_decision")).toEqual({
      icon: "help-circle-outline",
      color: "#F59E0B",
    });
  });
});

describe("applySuggestionStatusUpdate", () => {
  const suggestions: SuggestionLike[] = [
    { id: "sug-1" },
    { id: "sug-2" },
  ];

  it("removes processing suggestion", () => {
    expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "processing" })).toEqual([
      { id: "sug-2" },
    ]);
  });

  it("removes accepted suggestion", () => {
    expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "accepted" })).toEqual([
      { id: "sug-2" },
    ]);
  });

  it("removes dismissed suggestion", () => {
    expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "dismissed" })).toEqual([
      { id: "sug-2" },
    ]);
  });

  it("removes expired suggestion", () => {
    expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "expired" })).toEqual([
      { id: "sug-2" },
    ]);
  });

  it("keeps list unchanged for unrelated status", () => {
    expect(applySuggestionStatusUpdate(suggestions, { suggestionId: "sug-1", status: "open" })).toEqual(suggestions);
  });
});

describe("shouldRefetchSuggestions", () => {
  it("returns true for open and suspended status", () => {
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "open" })).toBe(true);
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "suspended" })).toBe(true);
  });

  it("returns false for terminal statuses", () => {
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "processing" })).toBe(false);
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "accepted" })).toBe(false);
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "dismissed" })).toBe(false);
    expect(shouldRefetchSuggestions({ suggestionId: "sug-1", status: "expired" })).toBe(false);
  });
});

describe("removeSuggestionOptimistically", () => {
  const suggestions: SuggestionLike[] = [
    { id: "sug-1" },
    { id: "sug-2" },
    { id: "sug-3" },
  ];

  it("removes suggestion and returns its original index", () => {
    expect(removeSuggestionOptimistically(suggestions, "sug-2")).toEqual({
      suggestions: [{ id: "sug-1" }, { id: "sug-3" }],
      removedIndex: 1,
    });
  });

  it("returns unchanged list when suggestion is missing", () => {
    expect(removeSuggestionOptimistically(suggestions, "missing")).toEqual({
      suggestions,
      removedIndex: -1,
    });
  });
});

describe("mergeFetchedSuggestions", () => {
  it("filters out pending removed suggestions from fetched list", () => {
    expect(mergeFetchedSuggestions([
      { id: "sug-1" },
      { id: "sug-2" },
      { id: "sug-3" },
    ], new Set(["sug-2"]))).toEqual([
      { id: "sug-1" },
      { id: "sug-3" },
    ]);
  });
});

describe("groupSuggestionsByBucket", () => {
  it("groups suggestions into three lanes", () => {
    const result = groupSuggestionsByBucket([
      { id: "s1", bucket: "next_step" as SuggestionBucket },
      { id: "s2", bucket: "needs_decision" as SuggestionBucket },
      { id: "s3", bucket: "needs_human_input" as SuggestionBucket },
      { id: "s4", bucket: "unknown" as unknown as SuggestionBucket },
    ]);

    expect(result.nextStep.map((item) => item.id)).toEqual(["s1", "s4"]);
    expect(result.needsDecision.map((item) => item.id)).toEqual(["s2"]);
    expect(result.needsHumanInput.map((item) => item.id)).toEqual(["s3"]);
  });
});

describe("restoreSuggestionAtIndex", () => {
  const suggestions: SuggestionLike[] = [
    { id: "sug-1" },
    { id: "sug-3" },
  ];

  it("restores suggestion at its original index", () => {
    expect(restoreSuggestionAtIndex(suggestions, { id: "sug-2" }, 1)).toEqual([
      { id: "sug-1" },
      { id: "sug-2" },
      { id: "sug-3" },
    ]);
  });

  it("appends when original index is out of range", () => {
    expect(restoreSuggestionAtIndex(suggestions, { id: "sug-4" }, 99)).toEqual([
      { id: "sug-1" },
      { id: "sug-3" },
      { id: "sug-4" },
    ]);
  });

  it("does not duplicate suggestion when already restored", () => {
    expect(restoreSuggestionAtIndex([
      { id: "sug-1" },
      { id: "sug-2" },
      { id: "sug-3" },
    ], { id: "sug-2" }, 1)).toEqual([
      { id: "sug-1" },
      { id: "sug-2" },
      { id: "sug-3" },
    ]);
  });
});
