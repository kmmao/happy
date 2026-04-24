import { describe, expect, it } from "vitest";

import {
  AIBackendProfileSchema,
  createResolvedRuntimeProfile,
  getBuiltInAIBackendProfile,
  normalizeResolvedRuntimeProfile,
  RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
  isTrustedRuntimeProfile,
} from "./profile";

describe("AIBackendProfileSchema", () => {
  it("accepts built-in profile ids and startup scripts", () => {
    const profile = AIBackendProfileSchema.parse({
      id: "openai",
      name: "OpenAI",
      isBuiltIn: true,
      startupBashScript: "export EXTRA_FLAG=1",
      environmentVariables: [],
    });

    expect(profile.id).toBe("openai");
    expect(profile.startupBashScript).toBe("export EXTRA_FLAG=1");
  });
});

describe("createResolvedRuntimeProfile", () => {
  it("preserves runtime semantics beyond plain environment variables", () => {
    const profile = AIBackendProfileSchema.parse({
      id: "custom-profile",
      name: "Custom Profile",
      environmentVariables: [
        { name: "OPENAI_API_KEY", value: "${OPENAI_API_KEY}" },
      ],
      startupBashScript: "export EXTRA_FLAG=1",
      customModels: [
        { id: "custom-model", name: "Custom Model" },
      ],
      modelMappings: {
        sonnet: "custom-model",
      },
      defaultSessionType: "worktree",
      defaultPermissionMode: "plan",
      defaultModelMode: "custom-model",
    });

    const runtimeProfile = createResolvedRuntimeProfile(profile, {
      source: "account-profile",
      trust: "trusted",
      environmentVariables: {
        OPENAI_API_KEY: "sk-test",
      },
    });

    expect(runtimeProfile).toMatchObject({
      schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
      profileId: "custom-profile",
      profileName: "Custom Profile",
      source: "account-profile",
      trust: "trusted",
      startupBashScript: "export EXTRA_FLAG=1",
      environmentVariables: {
        OPENAI_API_KEY: "sk-test",
      },
      customModels: [{ id: "custom-model", name: "Custom Model" }],
      modelMappings: { sonnet: "custom-model" },
      defaultSessionType: "worktree",
      defaultPermissionMode: "plan",
      defaultModelMode: "custom-model",
    });
  });
});

describe("getBuiltInAIBackendProfile", () => {
  it("returns the full shared built-in profile definition", () => {
    const profile = getBuiltInAIBackendProfile("openai");

    expect(profile).toMatchObject({
      id: "openai",
      name: "OpenAI (GPT-5.5)",
      isBuiltIn: true,
      compatibility: {
        claude: false,
        codex: true,
        gemini: false,
      },
      environmentVariables: expect.arrayContaining([
        { name: "OPENAI_BASE_URL", value: "https://api.openai.com/v1" },
        { name: "OPENAI_MODEL", value: "gpt-5.5" },
        { name: "CODEX_SMALL_FAST_MODEL", value: "gpt-5.4-mini" },
      ]),
    });
  });
});

describe("normalizeResolvedRuntimeProfile", () => {
  it("fills schemaVersion for stored runtime profiles that predate versioning", () => {
    const runtimeProfile = normalizeResolvedRuntimeProfile({
      profileId: "profile-1",
      profileName: "Profile 1",
      source: "account-profile",
      trust: "trusted",
      environmentVariables: {
        OPENAI_API_KEY: "sk-test",
      },
    });

    expect(runtimeProfile).toMatchObject({
      schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
      profileId: "profile-1",
      source: "account-profile",
      trust: "trusted",
    });
  });

  it("only accepts legacy env-map payloads when compatibility is explicitly enabled", () => {
    expect(
      normalizeResolvedRuntimeProfile(
        {
          OPENAI_API_KEY: "sk-test",
        },
      ),
    ).toBeUndefined();

    expect(
      normalizeResolvedRuntimeProfile(
        {
          OPENAI_API_KEY: "sk-test",
        },
        {
          allowLegacyEnvironmentVariables: true,
          profileId: "profile-1",
          source: "account-profile",
          trust: "trusted",
        },
      ),
    ).toMatchObject({
      schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
      profileId: "profile-1",
      environmentVariables: {
        OPENAI_API_KEY: "sk-test",
      },
    });
  });
});

describe("isTrustedRuntimeProfile", () => {
  it("distinguishes trusted and untrusted runtime profiles", () => {
    expect(
      isTrustedRuntimeProfile({
        schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
        source: "account-profile",
        trust: "trusted",
        environmentVariables: {},
      }),
    ).toBe(true);
    expect(
      isTrustedRuntimeProfile({
        schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
        source: "ad-hoc",
        trust: "untrusted",
        environmentVariables: {},
      }),
    ).toBe(false);
  });
});
