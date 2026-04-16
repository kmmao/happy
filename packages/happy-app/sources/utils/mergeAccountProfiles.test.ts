import { describe, expect, it } from "vitest";
import type { ServerAiBackendProfile } from "@/sync/apiAccountProfiles";
import type { AIBackendProfile } from "@/sync/settings";
import { mergeAccountProfiles } from "./mergeAccountProfiles";

function createProfile(
  overrides: Partial<AIBackendProfile> = {},
): AIBackendProfile {
  return {
    id: "profile-1",
    name: "Test Profile",
    anthropicConfig: {},
    environmentVariables: [],
    compatibility: { claude: true, codex: true, gemini: true },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    version: "1.0.0",
    ...overrides,
  };
}

function createRemoteProfile(
  profile: AIBackendProfile,
  revision = 1,
): ServerAiBackendProfile {
  return {
    profile,
    revision,
    archivedAt: null,
  };
}

describe("mergeAccountProfiles", () => {
  it("keeps local-only custom profiles when the server payload does not include them", () => {
    const localCustomProfile = createProfile({
      id: "myself-gpt",
      name: "myself-gpt",
      updatedAt: 20,
    });

    const remoteBuiltInOverride = createRemoteProfile(
      createProfile({
        id: "openai",
        name: "OpenAI (GPT-5.4)",
        isBuiltIn: true,
        updatedAt: 10,
      }),
      3,
    );

    const result = mergeAccountProfiles({
      localProfiles: [localCustomProfile],
      remoteProfiles: [remoteBuiltInOverride],
    });

    expect(result.profiles.map((profile) => profile.id)).toEqual([
      "openai",
      "myself-gpt",
    ]);
    expect(result.revisions).toEqual({
      openai: 3,
    });
  });

  it("prefers the newer remote profile when the same id exists locally", () => {
    const result = mergeAccountProfiles({
      localProfiles: [
        createProfile({
          id: "openai",
          name: "OpenAI Local",
          updatedAt: 5,
        }),
      ],
      remoteProfiles: [
        createRemoteProfile(
          createProfile({
            id: "openai",
            name: "OpenAI Remote",
            updatedAt: 10,
          }),
          7,
        ),
      ],
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.name).toBe("OpenAI Remote");
    expect(result.revisions).toEqual({
      openai: 7,
    });
  });

  it("keeps the newer local profile while preserving the remote revision for later sync", () => {
    const result = mergeAccountProfiles({
      localProfiles: [
        createProfile({
          id: "openai",
          name: "OpenAI Local Draft",
          updatedAt: 50,
        }),
      ],
      remoteProfiles: [
        createRemoteProfile(
          createProfile({
            id: "openai",
            name: "OpenAI Remote",
            updatedAt: 10,
          }),
          9,
        ),
      ],
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.name).toBe("OpenAI Local Draft");
    expect(result.revisions).toEqual({
      openai: 9,
    });
  });

  it("does not resurrect a deleted remote profile when it has already been removed locally", () => {
    const result = mergeAccountProfiles({
      localProfiles: [],
      remoteProfiles: [],
    });

    expect(result.profiles).toEqual([]);
    expect(result.revisions).toEqual({});
  });
});
