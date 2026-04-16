import { describe, expect, it } from "vitest";
import type { AIBackendProfile } from "@/sync/settings";
import { getProfileConfigSummary } from "./profileConfigSummary";

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

describe("getProfileConfigSummary", () => {
  it("shows env-backed custom profile model and hostname without needing GUI-only config fields", () => {
    const profile = createProfile({
      environmentVariables: [
        {
          name: "ANTHROPIC_MODEL",
          value: "${Z_AI_MODEL:-GLM-4.6}",
        },
        {
          name: "ANTHROPIC_BASE_URL",
          value: "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}",
        },
      ],
    });

    expect(getProfileConfigSummary(profile)).toBe("GLM-4.6, api.z.ai");
  });

  it("prefers resolved daemon environment values when available", () => {
    const profile = createProfile({
      environmentVariables: [
        {
          name: "ANTHROPIC_MODEL",
          value: "${Z_AI_MODEL}",
        },
        {
          name: "ANTHROPIC_BASE_URL",
          value: "${Z_AI_BASE_URL}",
        },
      ],
    });

    expect(
      getProfileConfigSummary(profile, {
        daemonEnv: {
          Z_AI_MODEL: "GLM-4.6-Air",
          Z_AI_BASE_URL: "https://custom.z.ai/api/anthropic",
        },
      }),
    ).toBe("GLM-4.6-Air, custom.z.ai");
  });

  it("includes codex profile name and tmux details for custom codex profiles", () => {
    const profile = createProfile({
      codexConfig: {
        backendMode: "auto",
        configMode: "managed-profile",
        codexProfileName: "work-profile",
      },
      tmuxConfig: {
        sessionName: "happy",
        tmpDir: "/tmp/happy",
      },
    });

    expect(
      getProfileConfigSummary(profile, {
        includeTmux: true,
      }),
    ).toBe("work-profile, tmux: happy, dir: /tmp/happy");
  });
});
