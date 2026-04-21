import { z } from "zod";
import {
  CodexBackendModeSchema,
  CodexConfigModeSchema,
} from "./codexBackendSelection";

function isTemplateAwareUrl(value: string): boolean {
  if (!value) return true;
  if (/^\$\{[A-Z_][A-Z0-9_]*(:-[^}]*)?\}$/.test(value)) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const BuiltInAIBackendProfileIdSchema = z.enum([
  "anthropic",
  "deepseek",
  "zai",
  "openai",
  "azure-openai",
  "minimax",
  "kimi",
]);

export type BuiltInAIBackendProfileId = z.infer<
  typeof BuiltInAIBackendProfileIdSchema
>;

export const BUILT_IN_AI_BACKEND_PROFILE_IDS = new Set(
  BuiltInAIBackendProfileIdSchema.options,
);

export const EnvironmentVariableSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Invalid environment variable name"),
  value: z.string(),
});

export const ProfileCompatibilitySchema = z.object({
  claude: z.boolean().default(true),
  codex: z.boolean().default(true),
  gemini: z.boolean().default(true),
});

export const AnthropicConfigSchema = z.object({
  baseUrl: z
    .string()
    .refine(isTemplateAwareUrl, {
      message:
        "Must be a valid URL or ${VAR} or ${VAR:-default} template string",
    })
    .optional(),
  authToken: z.string().optional(),
  model: z.string().optional(),
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z
    .string()
    .refine(isTemplateAwareUrl, {
      message:
        "Must be a valid URL or ${VAR} or ${VAR:-default} template string",
    })
    .optional(),
  model: z.string().optional(),
});

export const AzureOpenAIConfigSchema = z.object({
  apiKey: z.string().optional(),
  endpoint: z
    .string()
    .refine(isTemplateAwareUrl, {
      message:
        "Must be a valid URL or ${VAR} or ${VAR:-default} template string",
    })
    .optional(),
  apiVersion: z.string().optional(),
  deploymentName: z.string().optional(),
});

export const TogetherAIConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export const CodexConfigSchema = z.object({
  backendMode: CodexBackendModeSchema.optional(),
  configMode: CodexConfigModeSchema.optional(),
  codexProfileName: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  reasoningSummary: z.string().optional(),
  verbosity: z.string().optional(),
  personality: z.string().optional(),
  serviceTier: z.string().optional(),
  webSearchEnabled: z.boolean().optional(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
});

export const TmuxConfigSchema = z.object({
  sessionName: z.string().optional(),
  tmpDir: z.string().optional(),
  updateEnvironment: z.boolean().optional(),
});

export const CustomModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().nullish(),
});

export const DefaultPermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "plan",
  "read-only",
  "safe-yolo",
  "yolo",
]);

export const AIBackendProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  anthropicConfig: AnthropicConfigSchema.optional(),
  openaiConfig: OpenAIConfigSchema.optional(),
  azureOpenAIConfig: AzureOpenAIConfigSchema.optional(),
  togetherAIConfig: TogetherAIConfigSchema.optional(),
  codexConfig: CodexConfigSchema.optional(),
  tmuxConfig: TmuxConfigSchema.optional(),
  startupBashScript: z.string().optional(),
  environmentVariables: z.array(EnvironmentVariableSchema).default([]),
  customModels: z.array(CustomModelSchema).optional(),
  modelMappings: z.record(z.string(), z.string()).optional(),
  defaultSessionType: z.enum(["simple", "worktree"]).optional(),
  defaultPermissionMode: DefaultPermissionModeSchema.optional(),
  defaultModelMode: z.string().optional(),
  compatibility: ProfileCompatibilitySchema.default({
    claude: true,
    codex: true,
    gemini: true,
  }),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  version: z.string().default("1.0.0"),
});

export type AIBackendProfile = z.infer<typeof AIBackendProfileSchema>;

export const RuntimeProfileSourceSchema = z.enum([
  "built-in-profile",
  "account-profile",
  "local-profile",
  "ad-hoc",
]);

export type RuntimeProfileSource = z.infer<typeof RuntimeProfileSourceSchema>;

export const RuntimeProfileTrustSchema = z.enum(["trusted", "untrusted"]);

export type RuntimeProfileTrust = z.infer<typeof RuntimeProfileTrustSchema>;

export const RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION = 1 as const;

export const ResolvedRuntimeProfileSchema = z.object({
  schemaVersion: z
    .literal(RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION)
    .default(RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION),
  profileId: z.string().optional(),
  profileName: z.string().optional(),
  source: RuntimeProfileSourceSchema,
  trust: RuntimeProfileTrustSchema,
  isBuiltIn: z.boolean().optional(),
  compatibility: ProfileCompatibilitySchema.optional(),
  environmentVariables: z.record(z.string(), z.string()).default({}),
  startupBashScript: z.string().optional(),
  customModels: z.array(CustomModelSchema).optional(),
  modelMappings: z.record(z.string(), z.string()).optional(),
  defaultSessionType: z.enum(["simple", "worktree"]).optional(),
  defaultPermissionMode: DefaultPermissionModeSchema.optional(),
  defaultModelMode: z.string().optional(),
});

export type ResolvedRuntimeProfile = z.infer<
  typeof ResolvedRuntimeProfileSchema
>;

/**
 * Shared built-in profile defaults used across App / Server / CLI.
 * Keep this as the single source of truth so non-App flows (scheduler/webhook)
 * can still resolve the full runtime semantics for built-in profiles.
 */
export function getBuiltInAIBackendProfile(
  id: string,
): AIBackendProfile | null {
  switch (id) {
    case "anthropic":
      return {
        id: "anthropic",
        name: "Anthropic (Default)",
        anthropicConfig: {},
        environmentVariables: [],
        defaultPermissionMode: "default",
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "deepseek":
      return {
        id: "deepseek",
        name: "DeepSeek (Reasoner)",
        anthropicConfig: {},
        environmentVariables: [
          {
            name: "ANTHROPIC_BASE_URL",
            value: "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/anthropic}",
          },
          { name: "ANTHROPIC_AUTH_TOKEN", value: "${DEEPSEEK_AUTH_TOKEN}" },
          {
            name: "API_TIMEOUT_MS",
            value: "${DEEPSEEK_API_TIMEOUT_MS:-600000}",
          },
          {
            name: "ANTHROPIC_MODEL",
            value: "${DEEPSEEK_MODEL:-deepseek-reasoner}",
          },
          {
            name: "ANTHROPIC_SMALL_FAST_MODEL",
            value: "${DEEPSEEK_SMALL_FAST_MODEL:-deepseek-chat}",
          },
          {
            name: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
            value: "${DEEPSEEK_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}",
          },
        ],
        defaultPermissionMode: "default",
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "zai":
      return {
        id: "zai",
        name: "Z.AI (GLM-4.6)",
        anthropicConfig: {},
        environmentVariables: [
          {
            name: "ANTHROPIC_BASE_URL",
            value: "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}",
          },
          { name: "ANTHROPIC_AUTH_TOKEN", value: "${Z_AI_AUTH_TOKEN}" },
          { name: "API_TIMEOUT_MS", value: "${Z_AI_API_TIMEOUT_MS:-3000000}" },
          { name: "ANTHROPIC_MODEL", value: "${Z_AI_MODEL:-GLM-4.6}" },
          {
            name: "ANTHROPIC_DEFAULT_OPUS_MODEL",
            value: "${Z_AI_OPUS_MODEL:-GLM-4.6}",
          },
          {
            name: "ANTHROPIC_DEFAULT_SONNET_MODEL",
            value: "${Z_AI_SONNET_MODEL:-GLM-4.6}",
          },
          {
            name: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            value: "${Z_AI_HAIKU_MODEL:-GLM-4.5-Air}",
          },
        ],
        defaultPermissionMode: "default",
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "openai":
      return {
        id: "openai",
        name: "OpenAI (GPT-5.4)",
        openaiConfig: {},
        environmentVariables: [
          { name: "OPENAI_BASE_URL", value: "https://api.openai.com/v1" },
          { name: "OPENAI_MODEL", value: "gpt-5.4" },
          { name: "OPENAI_API_TIMEOUT_MS", value: "600000" },
          { name: "OPENAI_SMALL_FAST_MODEL", value: "gpt-5.4" },
          { name: "API_TIMEOUT_MS", value: "600000" },
          { name: "CODEX_SMALL_FAST_MODEL", value: "gpt-5.4" },
        ],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "azure-openai":
      return {
        id: "azure-openai",
        name: "Azure OpenAI",
        azureOpenAIConfig: {},
        environmentVariables: [
          { name: "AZURE_OPENAI_API_VERSION", value: "2024-02-15-preview" },
          { name: "AZURE_OPENAI_DEPLOYMENT_NAME", value: "gpt-5.4" },
          { name: "OPENAI_API_TIMEOUT_MS", value: "600000" },
          { name: "API_TIMEOUT_MS", value: "600000" },
        ],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "minimax":
      return {
        id: "minimax",
        name: "MiniMax (M2.7)",
        anthropicConfig: {},
        environmentVariables: [
          {
            name: "ANTHROPIC_BASE_URL",
            value: "${MINIMAX_BASE_URL:-https://api.minimaxi.com/anthropic}",
          },
          {
            name: "ANTHROPIC_AUTH_TOKEN",
            value: "${MINIMAX_AUTH_TOKEN}",
          },
          {
            name: "API_TIMEOUT_MS",
            value: "${MINIMAX_API_TIMEOUT_MS:-3000000}",
          },
          {
            name: "ANTHROPIC_MODEL",
            value: "${MINIMAX_MODEL:-MiniMax-M2.7}",
          },
          {
            name: "ANTHROPIC_SMALL_FAST_MODEL",
            value: "${MINIMAX_SMALL_FAST_MODEL:-MiniMax-M2.7-highspeed}",
          },
          {
            name: "ANTHROPIC_DEFAULT_OPUS_MODEL",
            value: "${MINIMAX_OPUS_MODEL:-MiniMax-M2.7}",
          },
          {
            name: "ANTHROPIC_DEFAULT_SONNET_MODEL",
            value: "${MINIMAX_SONNET_MODEL:-MiniMax-M2.7}",
          },
          {
            name: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            value: "${MINIMAX_HAIKU_MODEL:-MiniMax-M2.7-highspeed}",
          },
          {
            name: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
            value: "1",
          },
        ],
        defaultPermissionMode: "default",
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    case "kimi":
      return {
        id: "kimi",
        name: "Kimi (K2.5)",
        anthropicConfig: {},
        environmentVariables: [
          {
            name: "ANTHROPIC_BASE_URL",
            value: "${KIMI_BASE_URL:-https://api.moonshot.ai/anthropic}",
          },
          {
            name: "ANTHROPIC_AUTH_TOKEN",
            value: "${KIMI_AUTH_TOKEN}",
          },
          {
            name: "API_TIMEOUT_MS",
            value: "${KIMI_API_TIMEOUT_MS:-3000000}",
          },
          {
            name: "ANTHROPIC_MODEL",
            value: "${KIMI_MODEL:-kimi-k2.5}",
          },
          {
            name: "ANTHROPIC_SMALL_FAST_MODEL",
            value: "${KIMI_SMALL_FAST_MODEL:-kimi-k2.5}",
          },
          {
            name: "ANTHROPIC_DEFAULT_OPUS_MODEL",
            value: "${KIMI_OPUS_MODEL:-kimi-k2.5}",
          },
          {
            name: "ANTHROPIC_DEFAULT_SONNET_MODEL",
            value: "${KIMI_SONNET_MODEL:-kimi-k2.5}",
          },
          {
            name: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            value: "${KIMI_HAIKU_MODEL:-kimi-k2.5}",
          },
          {
            name: "ENABLE_TOOL_SEARCH",
            value: "${KIMI_ENABLE_TOOL_SEARCH:-false}",
          },
        ],
        defaultPermissionMode: "default",
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
      };
    default:
      return null;
  }
}

export function validateProfileForAgent(
  profile: AIBackendProfile,
  agent: "claude" | "codex" | "gemini",
): boolean {
  return profile.compatibility[agent];
}

export function getProfileEnvironmentVariables(
  profile: AIBackendProfile,
): Record<string, string> {
  const envVars: Record<string, string> = {};

  profile.environmentVariables.forEach((envVar) => {
    envVars[envVar.name] = envVar.value;
  });

  if (profile.anthropicConfig) {
    if (profile.anthropicConfig.baseUrl) {
      envVars.ANTHROPIC_BASE_URL = profile.anthropicConfig.baseUrl;
    }
    if (profile.anthropicConfig.authToken) {
      envVars.ANTHROPIC_AUTH_TOKEN = profile.anthropicConfig.authToken;
    }
    if (profile.anthropicConfig.model) {
      envVars.ANTHROPIC_MODEL = profile.anthropicConfig.model;
    }
  }

  if (profile.openaiConfig) {
    if (profile.openaiConfig.apiKey) {
      envVars.OPENAI_API_KEY = profile.openaiConfig.apiKey;
    }
    if (profile.openaiConfig.baseUrl) {
      envVars.OPENAI_BASE_URL = profile.openaiConfig.baseUrl;
    }
    if (profile.openaiConfig.model) {
      envVars.OPENAI_MODEL = profile.openaiConfig.model;
    }
  }

  if (profile.azureOpenAIConfig) {
    if (profile.azureOpenAIConfig.apiKey) {
      envVars.AZURE_OPENAI_API_KEY = profile.azureOpenAIConfig.apiKey;
    }
    if (profile.azureOpenAIConfig.endpoint) {
      envVars.AZURE_OPENAI_ENDPOINT = profile.azureOpenAIConfig.endpoint;
    }
    if (profile.azureOpenAIConfig.apiVersion) {
      envVars.AZURE_OPENAI_API_VERSION =
        profile.azureOpenAIConfig.apiVersion;
    }
    if (profile.azureOpenAIConfig.deploymentName) {
      envVars.AZURE_OPENAI_DEPLOYMENT_NAME =
        profile.azureOpenAIConfig.deploymentName;
    }
  }

  if (profile.togetherAIConfig) {
    if (profile.togetherAIConfig.apiKey) {
      envVars.TOGETHER_API_KEY = profile.togetherAIConfig.apiKey;
    }
    if (profile.togetherAIConfig.model) {
      envVars.TOGETHER_MODEL = profile.togetherAIConfig.model;
    }
  }

  if (profile.codexConfig) {
    if (profile.codexConfig.backendMode) {
      envVars.HAPPY_CODEX_BACKEND = profile.codexConfig.backendMode;
    }
    if (profile.codexConfig.configMode) {
      envVars.HAPPY_CODEX_CONFIG_MODE = profile.codexConfig.configMode;
    }
    if (profile.codexConfig.codexProfileName) {
      envVars.HAPPY_CODEX_PROFILE = profile.codexConfig.codexProfileName;
    }
    if (profile.codexConfig.model) {
      envVars.HAPPY_CODEX_MODEL = profile.codexConfig.model;
    }
    if (profile.codexConfig.reasoningEffort) {
      envVars.HAPPY_CODEX_REASONING_EFFORT =
        profile.codexConfig.reasoningEffort;
    }
    if (profile.codexConfig.reasoningSummary) {
      envVars.HAPPY_CODEX_REASONING_SUMMARY =
        profile.codexConfig.reasoningSummary;
    }
    if (profile.codexConfig.verbosity) {
      envVars.HAPPY_CODEX_VERBOSITY = profile.codexConfig.verbosity;
    }
    if (profile.codexConfig.personality) {
      envVars.HAPPY_CODEX_PERSONALITY = profile.codexConfig.personality;
    }
    if (profile.codexConfig.serviceTier) {
      envVars.HAPPY_CODEX_SERVICE_TIER = profile.codexConfig.serviceTier;
    }
    if (profile.codexConfig.webSearchEnabled !== undefined) {
      envVars.HAPPY_CODEX_WEB_SEARCH = profile.codexConfig.webSearchEnabled
        ? "live"
        : "disabled";
    }
    if (profile.codexConfig.approvalPolicy) {
      envVars.HAPPY_CODEX_APPROVAL_POLICY =
        profile.codexConfig.approvalPolicy;
    }
    if (profile.codexConfig.sandboxMode) {
      envVars.HAPPY_CODEX_SANDBOX_MODE = profile.codexConfig.sandboxMode;
    }
  }

  if (profile.tmuxConfig) {
    if (profile.tmuxConfig.sessionName !== undefined) {
      envVars.TMUX_SESSION_NAME = profile.tmuxConfig.sessionName;
    }
    if (profile.tmuxConfig.tmpDir) {
      envVars.TMUX_TMPDIR = profile.tmuxConfig.tmpDir;
    }
    if (profile.tmuxConfig.updateEnvironment !== undefined) {
      envVars.TMUX_UPDATE_ENVIRONMENT =
        profile.tmuxConfig.updateEnvironment.toString();
    }
  }

  return envVars;
}

interface CreateResolvedRuntimeProfileOptions {
  source?: RuntimeProfileSource;
  trust?: RuntimeProfileTrust;
  environmentVariables?: Record<string, string>;
}

export function createResolvedRuntimeProfile(
  profile: AIBackendProfile,
  options: CreateResolvedRuntimeProfileOptions = {},
): ResolvedRuntimeProfile {
  const source =
    options.source ??
    (profile.isBuiltIn ? "built-in-profile" : "account-profile");
  const trust = options.trust ?? (source === "ad-hoc" ? "untrusted" : "trusted");

  return {
    schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
    profileId: profile.id,
    profileName: profile.name,
    source,
    trust,
    isBuiltIn: profile.isBuiltIn,
    compatibility: profile.compatibility,
    environmentVariables: {
      ...getProfileEnvironmentVariables(profile),
      ...(options.environmentVariables ?? {}),
    },
    startupBashScript: profile.startupBashScript,
    customModels: profile.customModels,
    modelMappings: profile.modelMappings,
    defaultSessionType: profile.defaultSessionType,
    defaultPermissionMode: profile.defaultPermissionMode,
    defaultModelMode: profile.defaultModelMode,
  };
}

function extractLegacyRuntimeProfileEnvironmentVariables(
  input: unknown,
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const entries = Object.entries(input as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === "string" && typeof entry[1] === "string",
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function normalizeResolvedRuntimeProfile(
  input: unknown,
  options: {
    allowLegacyEnvironmentVariables?: boolean;
    profileId?: string | null;
    profileName?: string | null;
    source?: RuntimeProfileSource;
    trust?: RuntimeProfileTrust;
    isBuiltIn?: boolean;
  } = {},
): ResolvedRuntimeProfile | undefined {
  if (input == null) {
    return undefined;
  }

  const parsed = ResolvedRuntimeProfileSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  if (!options.allowLegacyEnvironmentVariables) {
    return undefined;
  }

  const legacyEnvironmentVariables =
    extractLegacyRuntimeProfileEnvironmentVariables(input);
  if (
    !legacyEnvironmentVariables &&
    !options.profileId &&
    !options.profileName
  ) {
    return undefined;
  }

  return ResolvedRuntimeProfileSchema.parse({
    schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
    profileId: options.profileId ?? undefined,
    profileName: options.profileName ?? options.profileId ?? undefined,
    source: options.source ?? "ad-hoc",
    trust: options.trust ?? "untrusted",
    isBuiltIn: options.isBuiltIn,
    environmentVariables: legacyEnvironmentVariables ?? {},
  });
}

export function isTrustedRuntimeProfile(
  runtimeProfile: ResolvedRuntimeProfile | null | undefined,
): boolean {
  return runtimeProfile?.trust === "trusted";
}
