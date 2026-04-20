import { describe, expect, it } from "vitest";

import {
  getExplicitProfileFallbackError,
  shouldIsolateProfileFromDaemonDefaults,
} from "./profileRuntimeGuard";

describe("shouldIsolateProfileFromDaemonDefaults", () => {
  it("does not isolate when no explicit profile is selected", () => {
    expect(shouldIsolateProfileFromDaemonDefaults({})).toBe(false);
  });

  it("does not isolate built-in profiles", () => {
    expect(
      shouldIsolateProfileFromDaemonDefaults({
        profileId: "anthropic",
        runtimeProfile: {
          schemaVersion: 1,
          profileId: "anthropic",
          source: "built-in-profile",
          trust: "trusted",
          environmentVariables: {},
        },
      }),
    ).toBe(false);
  });

  it("isolates explicit non-built-in profiles", () => {
    expect(
      shouldIsolateProfileFromDaemonDefaults({
        profileId: "gpt2claude",
        runtimeProfile: {
          schemaVersion: 1,
          profileId: "gpt2claude",
          source: "account-profile",
          trust: "trusted",
          environmentVariables: {},
        },
      }),
    ).toBe(true);
  });
});

describe("getExplicitProfileFallbackError", () => {
  const runtimeProfile = {
    schemaVersion: 1 as const,
    profileId: "gpt2claude",
    source: "account-profile" as const,
    trust: "trusted" as const,
    environmentVariables: {},
  };

  it("returns an explicit error when a custom profile has no runtime env or startup script", () => {
    expect(
      getExplicitProfileFallbackError({
        profileId: "gpt2claude",
        runtimeProfile,
        resolvedProfileEnv: {},
      }),
    ).toContain('Profile "gpt2claude" is selected');
  });

  it("allows custom profiles that provide runtime env vars", () => {
    expect(
      getExplicitProfileFallbackError({
        profileId: "gpt2claude",
        runtimeProfile,
        resolvedProfileEnv: {
          ANTHROPIC_BASE_URL: "https://example.com",
        },
      }),
    ).toBeNull();
  });

  it("allows custom profiles that rely on a startup script", () => {
    expect(
      getExplicitProfileFallbackError({
        profileId: "gpt2claude",
        runtimeProfile,
        resolvedProfileEnv: {},
        startupBashScript: "export ANTHROPIC_AUTH_TOKEN=from-script",
      }),
    ).toBeNull();
  });
});
