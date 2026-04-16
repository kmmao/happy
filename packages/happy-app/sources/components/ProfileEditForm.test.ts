import { describe, expect, it } from "vitest";
import type { AIBackendProfile } from "@/sync/settings";
import { buildProfileForSave } from "./profileSavePayload";

const baseProfile: AIBackendProfile = {
  id: "profile-1",
  name: "Original",
  anthropicConfig: { model: "claude-sonnet" },
  openaiConfig: {},
  azureOpenAIConfig: {},
  codexConfig: undefined,
  environmentVariables: [],
  compatibility: { claude: true, codex: true, gemini: true },
  isBuiltIn: false,
  createdAt: 111,
  updatedAt: 222,
  version: "1.0.0",
};

describe("buildProfileForSave", () => {
  it("omits timestamp fields that the server mutation schema rejects", () => {
    const result = buildProfileForSave({
      profile: baseProfile,
      name: " Saved Profile ",
      environmentVariables: [{ name: "OPENAI_API_KEY", value: "test" }],
      useTmux: false,
      tmuxSession: "",
      tmuxTmpDir: "",
      useStartupScript: false,
      startupScript: "",
      agentType: "claude",
      defaultSessionType: "simple",
      defaultPermissionMode: "default",
      codexBackendMode: "auto",
      codexConfigMode: "inherit",
      codexProfileName: "",
      codexOverrideModel: "",
      codexOverrideReasoningEffort: "",
      codexOverrideReasoningSummary: "",
      codexOverrideVerbosity: "",
      codexOverridePersonality: "",
      codexOverrideServiceTier: "",
      codexOverrideWebSearch: "",
      codexOverrideApprovalPolicy: "",
      codexOverrideSandboxMode: "",
    });

    expect(result.name).toBe("Saved Profile");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });
});
