import type { AIBackendProfile } from "@/sync/settings";
import type {
  CodexBackendModeValue,
  CodexConfigModeValue,
} from "@/sync/codexConfigPresentation";

interface BuildProfileForSaveOptions {
  profile: AIBackendProfile;
  name: string;
  environmentVariables: Array<{ name: string; value: string }>;
  useTmux: boolean;
  tmuxSession: string;
  tmuxTmpDir: string;
  useStartupScript: boolean;
  startupScript: string;
  agentType: "claude" | "codex";
  defaultSessionType: "simple" | "worktree";
  defaultPermissionMode: NonNullable<AIBackendProfile["defaultPermissionMode"]>;
  codexBackendMode: CodexBackendModeValue;
  codexConfigMode: CodexConfigModeValue;
  codexProfileName: string;
  codexOverrideModel: string;
  codexOverrideReasoningEffort: string;
  codexOverrideReasoningSummary: string;
  codexOverrideVerbosity: string;
  codexOverridePersonality: string;
  codexOverrideServiceTier: string;
  codexOverrideWebSearch: string;
  codexOverrideApprovalPolicy: string;
  codexOverrideSandboxMode: string;
}

export function buildProfileForSave({
  profile,
  name,
  environmentVariables,
  useTmux,
  tmuxSession,
  tmuxTmpDir,
  useStartupScript,
  startupScript,
  agentType,
  defaultSessionType,
  defaultPermissionMode,
  codexBackendMode,
  codexConfigMode,
  codexProfileName,
  codexOverrideModel,
  codexOverrideReasoningEffort,
  codexOverrideReasoningSummary,
  codexOverrideVerbosity,
  codexOverridePersonality,
  codexOverrideServiceTier,
  codexOverrideWebSearch,
  codexOverrideApprovalPolicy,
  codexOverrideSandboxMode,
}: BuildProfileForSaveOptions): Omit<AIBackendProfile, "createdAt" | "updatedAt"> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...profileWithoutTimestamps } = profile;

  return {
    ...profileWithoutTimestamps,
    name: name.trim(),
    anthropicConfig: {},
    openaiConfig: {},
    azureOpenAIConfig: {},
    environmentVariables,
    tmuxConfig: useTmux
      ? {
          sessionName: tmuxSession.trim() || "",
          tmpDir: tmuxTmpDir.trim() || undefined,
          updateEnvironment: undefined,
        }
      : {
          sessionName: undefined,
          tmpDir: undefined,
          updateEnvironment: undefined,
        },
    startupBashScript: useStartupScript ? startupScript.trim() || undefined : undefined,
    codexConfig:
      agentType === "codex"
        ? {
            backendMode: codexBackendMode,
            configMode: codexConfigMode,
            codexProfileName:
              codexConfigMode === "managed-profile"
                ? codexProfileName.trim() || undefined
                : undefined,
            ...(codexConfigMode === "managed-overrides" && codexOverrideModel.trim()
              ? { model: codexOverrideModel.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideReasoningEffort.trim()
              ? { reasoningEffort: codexOverrideReasoningEffort.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideReasoningSummary.trim()
              ? { reasoningSummary: codexOverrideReasoningSummary.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideVerbosity.trim()
              ? { verbosity: codexOverrideVerbosity.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverridePersonality.trim()
              ? { personality: codexOverridePersonality.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideServiceTier.trim()
              ? { serviceTier: codexOverrideServiceTier.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideWebSearch.trim()
              ? { webSearchEnabled: codexOverrideWebSearch.trim() === "live" }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideApprovalPolicy.trim()
              ? { approvalPolicy: codexOverrideApprovalPolicy.trim() }
              : {}),
            ...(codexConfigMode === "managed-overrides" && codexOverrideSandboxMode.trim()
              ? { sandboxMode: codexOverrideSandboxMode.trim() }
              : {}),
          }
        : profile.codexConfig,
    defaultSessionType,
    defaultPermissionMode,
  };
}
