import { describe, expect, it } from "vitest";
import {
  areSessionPreferencesEqual,
  buildSessionPreferencesSnapshot,
  overlayPendingSessionPreferences,
} from "./sessionPreferencesState";

describe("sessionPreferencesState", () => {
  it("normalizes session preferences into a stable snapshot", () => {
    expect(
      buildSessionPreferencesSnapshot({
        permissionMode: "default",
        modelMode: "default",
        pinnedModelId: null,
        customModels: null,
        modelMappings: null,
        profileId: null,
        profileName: null,
        thinkingMode: null,
        thinkingBudget: undefined,
        effortLevel: undefined,
        maxBudgetUsd: undefined,
        taskBudgetTokens: undefined,
      } as any),
    ).toEqual({
      permissionMode: "default",
      modelMode: "default",
      pinnedModelId: null,
      customModels: null,
      modelMappings: null,
      profileId: null,
      profileName: null,
      thinkingMode: null,
      thinkingBudget: null,
      effortLevel: null,
      maxBudgetUsd: null,
      taskBudgetTokens: null,
    });
  });

  it("treats undefined and null as the same normalized pending value", () => {
    expect(
      areSessionPreferencesEqual(
        {
          modelMode: "default",
          pinnedModelId: undefined,
        },
        {
          modelMode: "default",
          pinnedModelId: null,
        },
      ),
    ).toBe(true);
  });

  it("overlays pending preferences even when they explicitly reset to default/null", () => {
    const session = {
      id: "session-1",
      permissionMode: "read-only",
      modelMode: "gpt-5.4",
      pinnedModelId: "gpt-5.4",
      customModels: [{ id: "gpt-5.4", name: "GPT-5.4" }],
      modelMappings: { sonnet: "gpt-5.4" },
      profileId: "profile-1",
      profileName: "Profile 1",
      thinkingMode: "enabled",
      thinkingBudget: 4000,
      effortLevel: "high",
      maxBudgetUsd: 2,
      taskBudgetTokens: 2000,
    } as any;

    expect(
      overlayPendingSessionPreferences(session, {
        permissionMode: "default",
        modelMode: "default",
        pinnedModelId: null,
        customModels: null,
        modelMappings: null,
        profileId: null,
        profileName: null,
        thinkingMode: null,
        thinkingBudget: null,
        effortLevel: null,
        maxBudgetUsd: null,
        taskBudgetTokens: null,
      }),
    ).toEqual(
      expect.objectContaining({
        permissionMode: "default",
        modelMode: "default",
        pinnedModelId: null,
        customModels: null,
        modelMappings: null,
        profileId: null,
        profileName: null,
        thinkingMode: null,
        thinkingBudget: null,
        effortLevel: null,
        maxBudgetUsd: null,
        taskBudgetTokens: null,
      }),
    );
  });
});
