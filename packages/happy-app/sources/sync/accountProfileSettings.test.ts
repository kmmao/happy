import { describe, expect, it } from "vitest";
import type { Settings, AIBackendProfile } from "./settings";
import { settingsDefaults } from "./settings";
import {
  mergeServerSettingsWithLocalProfiles,
  stripManagedAccountProfileSettings,
} from "./accountProfileSettings";

function createProfile(overrides: Partial<AIBackendProfile> = {}): AIBackendProfile {
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

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...settingsDefaults,
    ...overrides,
  };
}

describe("accountProfileSettings", () => {
  it("does not include managed profiles in account settings sync payloads", () => {
    const result = stripManagedAccountProfileSettings({
      profiles: [createProfile({ id: "openai" })],
      lastUsedProfile: "openai",
    });

    expect(result).toEqual({
      lastUsedProfile: "openai",
    });
    expect(result).not.toHaveProperty("profiles");
  });

  it("preserves locally hydrated profiles when fresh settings arrive from the account settings API", () => {
    const localProfiles = [
      createProfile({
        id: "myself-gpt",
        name: "myself-gpt",
        updatedAt: 20,
      }),
    ];

    const serverSettings = createSettings({
      profiles: [],
      lastUsedProfile: "myself-gpt",
    });

    const result = mergeServerSettingsWithLocalProfiles(serverSettings, localProfiles);

    expect(result.lastUsedProfile).toBe("myself-gpt");
    expect(result.profiles).toEqual(localProfiles);
  });
});
