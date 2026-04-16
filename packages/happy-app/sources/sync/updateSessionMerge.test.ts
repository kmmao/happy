import { describe, expect, it } from "vitest";
import { mergeUpdatedSession } from "./updateSessionMerge";

describe("mergeUpdatedSession", () => {
  it("preserves existing metadata when decrypting a metadata update fails", () => {
    const existingMetadata = {
      path: "/Users/sangreal/Documents/dev-workspace/happy",
      host: "home-mac",
      machineId: "machine-1",
      flavor: "codex",
      models: [
        {
          code: "gpt-5.4",
          value: "GPT-5.4",
          description: null,
        },
      ],
    };

    const session = {
      id: "session-1",
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      active: true,
      activeAt: 1,
      rpcReady: true,
      metadata: existingMetadata,
      metadataVersion: 4,
      agentState: {},
      agentStateVersion: 1,
      preferencesVersion: 0,
      thinking: false,
      thinkingAt: 0,
      presence: "online",
      needsAttention: false,
      permissionMode: "default",
      modelMode: "default",
      draft: null,
    } as any;

    const result = mergeUpdatedSession({
      session,
      seq: 9,
      updatedAt: 999,
      agentState: session.agentState,
      agentStateVersion: session.agentStateVersion,
      metadata: null,
      metadataUpdate: {
        version: 5,
      },
      preferences: null,
      preferencesUpdate: undefined,
    });

    expect(result.metadataDecryptFailed).toBe(true);
    expect(result.updatedSession).toEqual(
      expect.objectContaining({
        metadata: existingMetadata,
        metadataVersion: 4,
        seq: 9,
        updatedAt: 999,
      }),
    );
  });

  it("applies newer metadata and preferences when decryption succeeds", () => {
    const session = {
      id: "session-1",
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      active: true,
      activeAt: 1,
      rpcReady: true,
      metadata: {
        path: "/old",
        host: "old-host",
      },
      metadataVersion: 1,
      agentState: {},
      agentStateVersion: 1,
      preferencesVersion: 1,
      thinking: false,
      thinkingAt: 0,
      presence: "online",
      needsAttention: false,
      permissionMode: "default",
      modelMode: "default",
      draft: null,
    } as any;

    const newMetadata = {
      path: "/new",
      host: "new-host",
      machineId: "machine-1",
      flavor: "codex",
    };

    const result = mergeUpdatedSession({
      session,
      seq: 3,
      updatedAt: 333,
      agentState: { requests: {} },
      agentStateVersion: 2,
      metadata: newMetadata,
      metadataUpdate: {
        version: 2,
      },
      preferences: {
        permissionMode: "read-only",
        modelMode: "gpt-5.4",
        pinnedModelId: "gpt-5.4",
        customModels: null,
        modelMappings: null,
        profileId: "openai",
        profileName: "OpenAI",
        thinkingMode: null,
        thinkingBudget: null,
        effortLevel: "high",
        maxBudgetUsd: 5,
        taskBudgetTokens: 4000,
      },
      preferencesUpdate: {
        version: 3,
      },
    });

    expect(result.metadataDecryptFailed).toBe(false);
    expect(result.updatedSession).toEqual(
      expect.objectContaining({
        metadata: newMetadata,
        metadataVersion: 2,
        preferencesVersion: 3,
        permissionMode: "read-only",
        modelMode: "gpt-5.4",
        pinnedModelId: "gpt-5.4",
        profileId: "openai",
        profileName: "OpenAI",
        effortLevel: "high",
        maxBudgetUsd: 5,
        taskBudgetTokens: 4000,
        seq: 3,
        updatedAt: 333,
      }),
    );
  });

  it("preserves local pending preferences even when the incoming server update still has stale values", () => {
    const session = {
      id: "session-1",
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      active: true,
      activeAt: 1,
      rpcReady: true,
      metadata: null,
      metadataVersion: 1,
      agentState: {},
      agentStateVersion: 1,
      preferencesVersion: 4,
      thinking: false,
      thinkingAt: 0,
      presence: "online",
      needsAttention: false,
      permissionMode: "default",
      modelMode: "default",
      pinnedModelId: null,
      customModels: null,
      modelMappings: null,
      profileId: null,
      profileName: null,
      draft: null,
    } as any;

    const result = mergeUpdatedSession({
      session,
      seq: 5,
      updatedAt: 555,
      agentState: {},
      agentStateVersion: 2,
      metadata: null,
      metadataUpdate: undefined,
      preferences: {
        permissionMode: "read-only",
        modelMode: "gpt-5.4",
        pinnedModelId: "gpt-5.4",
        customModels: null,
        modelMappings: null,
        profileId: "old-profile",
        profileName: "Old Profile",
        thinkingMode: null,
        thinkingBudget: null,
        effortLevel: null,
        maxBudgetUsd: null,
        taskBudgetTokens: null,
      },
      preferencesUpdate: {
        version: 5,
      },
      pendingPreferences: {
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
      },
    });

    expect(result.updatedSession).toEqual(
      expect.objectContaining({
        permissionMode: "default",
        modelMode: "default",
        pinnedModelId: null,
        profileId: null,
        profileName: null,
        preferencesVersion: 5,
      }),
    );
  });
});
