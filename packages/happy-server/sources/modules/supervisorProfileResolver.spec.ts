import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  decryptAiBackendProfile: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
  db: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock("@/modules/aiBackendProfileCrypto", () => ({
  decryptAiBackendProfile: mocks.decryptAiBackendProfile,
}));

import { resolveSupervisorProfile } from "./supervisorProfileResolver";

describe("resolveSupervisorProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates built-in profiles from the shared default catalog when no account row exists", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    const result = await resolveSupervisorProfile("user-1", "openai");

    expect(result.profileName).toBe("OpenAI (GPT-5.4)");
    expect(result.runtimeProfile).toMatchObject({
      schemaVersion: 1,
      profileId: "openai",
      profileName: "OpenAI (GPT-5.4)",
      source: "built-in-profile",
      trust: "trusted",
      isBuiltIn: true,
      compatibility: {
        claude: false,
        codex: true,
        gemini: false,
      },
      environmentVariables: {
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: "gpt-5.4",
        OPENAI_API_TIMEOUT_MS: "600000",
        OPENAI_SMALL_FAST_MODEL: "gpt-5.4",
        API_TIMEOUT_MS: "600000",
        CODEX_SMALL_FAST_MODEL: "gpt-5.4",
      },
    });
    expect(mocks.decryptAiBackendProfile).not.toHaveBeenCalled();
  });
});
