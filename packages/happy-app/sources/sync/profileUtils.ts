import { getBuiltInAIBackendProfile } from "@kmmao/happy-wire";
import { AIBackendProfile } from "./settings";

export const mergeProfilesForDisplay = (
  remoteProfiles: AIBackendProfile[],
  localProfiles: AIBackendProfile[],
): AIBackendProfile[] => {
  const mergedProfiles = new Map<string, AIBackendProfile>(
    localProfiles.map((profile) => [profile.id, profile]),
  );

  remoteProfiles.forEach((profile) => {
    mergedProfiles.set(profile.id, profile);
  });

  return Array.from(mergedProfiles.values());
};

/**
 * Documentation and expected values for built-in profiles.
 * These help users understand what environment variables to set and their expected values.
 */
export interface ProfileDocumentation {
  setupGuideUrl?: string; // Link to official setup documentation
  description: string; // Clear description of what this profile does
  environmentVariables: {
    name: string; // Environment variable name (e.g., "Z_AI_BASE_URL")
    expectedValue: string; // What value it should have (e.g., "https://api.z.ai/api/anthropic")
    description: string; // What this variable does
    isSecret: boolean; // Whether this is a secret (never retrieve or display actual value)
  }[];
  shellConfigExample: string; // Example .zshrc/.bashrc configuration
}

/**
 * Get documentation for a built-in profile.
 * Returns setup instructions, expected values, and configuration examples.
 */
export const getBuiltInProfileDocumentation = (
  id: string,
): ProfileDocumentation | null => {
  switch (id) {
    case "anthropic":
      return {
        description:
          "Official Anthropic Claude API - uses your default Anthropic credentials",
        environmentVariables: [],
        shellConfigExample: `# No additional environment variables needed
# Uses ANTHROPIC_AUTH_TOKEN from your login session`,
      };
    case "deepseek":
      return {
        setupGuideUrl: "https://api-docs.deepseek.com/",
        description:
          "DeepSeek Reasoner API proxied through Anthropic-compatible interface",
        environmentVariables: [
          {
            name: "DEEPSEEK_BASE_URL",
            expectedValue: "https://api.deepseek.com/anthropic",
            description: "DeepSeek API endpoint (Anthropic-compatible)",
            isSecret: false,
          },
          {
            name: "DEEPSEEK_AUTH_TOKEN",
            expectedValue: "sk-...",
            description: "Your DeepSeek API key",
            isSecret: true,
          },
          {
            name: "DEEPSEEK_API_TIMEOUT_MS",
            expectedValue: "600000",
            description: "API timeout (10 minutes for reasoning models)",
            isSecret: false,
          },
          {
            name: "DEEPSEEK_MODEL",
            expectedValue: "deepseek-reasoner",
            description:
              "Default model (reasoning model for complex debugging/algorithms, use deepseek-chat for faster general tasks)",
            isSecret: false,
          },
          {
            name: "DEEPSEEK_SMALL_FAST_MODEL",
            expectedValue: "deepseek-chat",
            description: "Fast model for quick responses",
            isSecret: false,
          },
          {
            name: "DEEPSEEK_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
            expectedValue: "1",
            description: "Disable non-essential network traffic",
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export DEEPSEEK_BASE_URL="https://api.deepseek.com/anthropic"
export DEEPSEEK_AUTH_TOKEN="sk-YOUR_DEEPSEEK_API_KEY"
export DEEPSEEK_API_TIMEOUT_MS="600000"
export DEEPSEEK_MODEL="deepseek-reasoner"
export DEEPSEEK_SMALL_FAST_MODEL="deepseek-chat"
export DEEPSEEK_CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"

# Model selection guide:
# - deepseek-reasoner: Best for complex debugging, algorithms, precision (slower but more accurate)
# - deepseek-chat: Best for everyday coding, boilerplate, speed (handles 80% of general tasks)`,
      };
    case "zai":
      return {
        setupGuideUrl: "https://docs.z.ai/devpack/tool/claude",
        description:
          "Z.AI GLM-4.6 API proxied through Anthropic-compatible interface",
        environmentVariables: [
          {
            name: "Z_AI_BASE_URL",
            expectedValue: "https://api.z.ai/api/anthropic",
            description: "Z.AI API endpoint (Anthropic-compatible)",
            isSecret: false,
          },
          {
            name: "Z_AI_AUTH_TOKEN",
            expectedValue: "sk-...",
            description: "Your Z.AI API key",
            isSecret: true,
          },
          {
            name: "Z_AI_API_TIMEOUT_MS",
            expectedValue: "3000000",
            description: "API timeout (50 minutes)",
            isSecret: false,
          },
          {
            name: "Z_AI_MODEL",
            expectedValue: "GLM-4.6",
            description: "Default model",
            isSecret: false,
          },
          {
            name: "Z_AI_OPUS_MODEL",
            expectedValue: "GLM-4.6",
            description: 'Model for "Opus" tasks (maps to GLM-4.6)',
            isSecret: false,
          },
          {
            name: "Z_AI_SONNET_MODEL",
            expectedValue: "GLM-4.6",
            description: 'Model for "Sonnet" tasks (maps to GLM-4.6)',
            isSecret: false,
          },
          {
            name: "Z_AI_HAIKU_MODEL",
            expectedValue: "GLM-4.5-Air",
            description: 'Model for "Haiku" tasks (maps to GLM-4.5-Air)',
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export Z_AI_BASE_URL="https://api.z.ai/api/anthropic"
export Z_AI_AUTH_TOKEN="sk-YOUR_ZAI_API_KEY"
export Z_AI_API_TIMEOUT_MS="3000000"
export Z_AI_MODEL="GLM-4.6"
export Z_AI_OPUS_MODEL="GLM-4.6"
export Z_AI_SONNET_MODEL="GLM-4.6"
export Z_AI_HAIKU_MODEL="GLM-4.5-Air"`,
      };
    case "openai":
      return {
        setupGuideUrl: "https://platform.openai.com/docs/api-reference",
        description:
          "OpenAI GPT-5.4 API for code generation and completion",
        environmentVariables: [
          {
            name: "OPENAI_BASE_URL",
            expectedValue: "https://api.openai.com/v1",
            description: "OpenAI API endpoint",
            isSecret: false,
          },
          {
            name: "OPENAI_API_KEY",
            expectedValue: "",
            description: "Your OpenAI API key",
            isSecret: true,
          },
          {
            name: "OPENAI_MODEL",
            expectedValue: "gpt-5.4",
            description: "Default model for code tasks",
            isSecret: false,
          },
          {
            name: "OPENAI_SMALL_FAST_MODEL",
            expectedValue: "gpt-5.4",
            description: "Pinned model for Codex and quick responses",
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="sk-YOUR_OPENAI_API_KEY"
export OPENAI_MODEL="gpt-5.4"
export OPENAI_SMALL_FAST_MODEL="gpt-5.4"`,
      };
    case "azure-openai":
      return {
        setupGuideUrl:
          "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
        description:
          "Azure OpenAI Service for enterprise-grade AI with enhanced security and compliance",
        environmentVariables: [
          {
            name: "AZURE_OPENAI_ENDPOINT",
            expectedValue: "https://YOUR_RESOURCE.openai.azure.com",
            description: "Your Azure OpenAI endpoint URL",
            isSecret: false,
          },
          {
            name: "AZURE_OPENAI_API_KEY",
            expectedValue: "",
            description: "Your Azure OpenAI API key",
            isSecret: true,
          },
          {
            name: "AZURE_OPENAI_API_VERSION",
            expectedValue: "2024-02-15-preview",
            description: "Azure OpenAI API version",
            isSecret: false,
          },
          {
            name: "AZURE_OPENAI_DEPLOYMENT_NAME",
            expectedValue: "gpt-5.4",
            description: "Your deployment name for the model",
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export AZURE_OPENAI_ENDPOINT="https://YOUR_RESOURCE.openai.azure.com"
export AZURE_OPENAI_API_KEY="YOUR_AZURE_API_KEY"
export AZURE_OPENAI_API_VERSION="2024-02-15-preview"
export AZURE_OPENAI_DEPLOYMENT_NAME="gpt-5.4"`,
      };
    case "minimax":
      return {
        setupGuideUrl:
          "https://platform.minimaxi.com/docs/api-reference/text-anthropic-api",
        description:
          "MiniMax M2.7 API proxied through Anthropic-compatible interface",
        environmentVariables: [
          {
            name: "MINIMAX_BASE_URL",
            expectedValue: "https://api.minimaxi.com/anthropic",
            description: "MiniMax API endpoint (Anthropic-compatible)",
            isSecret: false,
          },
          {
            name: "MINIMAX_AUTH_TOKEN",
            expectedValue: "eyJ...",
            description: "Your MiniMax API key (JWT token from platform)",
            isSecret: true,
          },
          {
            name: "MINIMAX_API_TIMEOUT_MS",
            expectedValue: "600000",
            description: "API timeout (10 minutes)",
            isSecret: false,
          },
          {
            name: "MINIMAX_MODEL",
            expectedValue: "MiniMax-M2.7",
            description: "Default model (most capable, 204K context)",
            isSecret: false,
          },
          {
            name: "MINIMAX_SMALL_FAST_MODEL",
            expectedValue: "MiniMax-M2.7-highspeed",
            description: "Fast model for quick responses (~100 TPS)",
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export MINIMAX_BASE_URL="https://api.minimaxi.com/anthropic"
export MINIMAX_AUTH_TOKEN="YOUR_MINIMAX_API_KEY"
export MINIMAX_API_TIMEOUT_MS="3000000"
export MINIMAX_MODEL="MiniMax-M2.7"
export MINIMAX_SMALL_FAST_MODEL="MiniMax-M2.7-highspeed"

# Model tier mappings (Opus/Sonnet/Haiku → MiniMax models):
# These are set automatically by the profile via ANTHROPIC_DEFAULT_*_MODEL env vars.
# Override if needed:
# export MINIMAX_OPUS_MODEL="MiniMax-M2.7"
# export MINIMAX_SONNET_MODEL="MiniMax-M2.7"
# export MINIMAX_HAIKU_MODEL="MiniMax-M2.7-highspeed"`,
      };
    case "kimi":
      return {
        setupGuideUrl: "https://platform.moonshot.ai/docs/guide/agent-support.en-US",
        description:
          "Kimi K2.5 API proxied through Anthropic-compatible interface",
        environmentVariables: [
          {
            name: "KIMI_BASE_URL",
            expectedValue: "https://api.moonshot.ai/anthropic",
            description: "Kimi API endpoint (Anthropic-compatible)",
            isSecret: false,
          },
          {
            name: "KIMI_AUTH_TOKEN",
            expectedValue: "sk-...",
            description: "Your Kimi (Moonshot) API key",
            isSecret: true,
          },
          {
            name: "KIMI_API_TIMEOUT_MS",
            expectedValue: "3000000",
            description: "API timeout (50 minutes)",
            isSecret: false,
          },
          {
            name: "KIMI_MODEL",
            expectedValue: "kimi-k2.5",
            description: "Default model",
            isSecret: false,
          },
          {
            name: "KIMI_SMALL_FAST_MODEL",
            expectedValue: "kimi-k2.5",
            description: "Fast model for quick responses",
            isSecret: false,
          },
          {
            name: "KIMI_ENABLE_TOOL_SEARCH",
            expectedValue: "false",
            description:
              "Disable tool search by default to align with Moonshot guide",
            isSecret: false,
          },
        ],
        shellConfigExample: `# Add to ~/.zshrc or ~/.bashrc:
export KIMI_BASE_URL="https://api.moonshot.ai/anthropic"
export KIMI_AUTH_TOKEN="sk-YOUR_KIMI_API_KEY"
export KIMI_API_TIMEOUT_MS="3000000"
export KIMI_MODEL="kimi-k2.5"
export KIMI_SMALL_FAST_MODEL="kimi-k2.5"
export KIMI_ENABLE_TOOL_SEARCH="false"

# Model tier mappings (Opus/Sonnet/Haiku → Kimi models):
# These are set automatically by the profile via ANTHROPIC_DEFAULT_*_MODEL env vars.
# Override if needed:
# export KIMI_OPUS_MODEL="kimi-k2.5"
# export KIMI_SONNET_MODEL="kimi-k2.5"
# export KIMI_HAIKU_MODEL="kimi-k2.5"`,
      };
    default:
      return null;
  }
};

/**
 * Get a built-in AI backend profile by ID.
 * Built-in profiles provide sensible defaults for popular AI providers.
 *
 * ENVIRONMENT VARIABLE FLOW:
 * 1. User launches daemon with env vars: Z_AI_AUTH_TOKEN=sk-... Z_AI_BASE_URL=https://api.z.ai
 * 2. Profile defines mappings: ANTHROPIC_AUTH_TOKEN=${Z_AI_AUTH_TOKEN}
 * 3. When spawning session, daemon expands ${VAR} from its process.env
 * 4. Session receives: ANTHROPIC_AUTH_TOKEN=sk-... (actual value)
 * 5. Claude CLI reads ANTHROPIC_* env vars, connects to Z.AI
 *
 * This pattern lets users:
 * - Set credentials ONCE when launching daemon
 * - Switch backends by selecting different profiles
 * - Each profile maps daemon env vars to what CLI expects
 *
 * @param id - The profile ID (anthropic, deepseek, zai, openai, azure-openai, minimax, kimi)
 * @returns The complete profile configuration, or null if not found
 */
export const getBuiltInProfile = (id: string): AIBackendProfile | null => {
  return getBuiltInAIBackendProfile(id);
};

/**
 * Default built-in profiles available to all users.
 * These provide quick-start configurations for popular AI providers.
 */
export const LEGACY_BUILT_IN_PROFILE_ALIASES: Record<string, string[]> = {
  codex: ["OpenAI (GPT-4/Codex)"],
  "azure-openai": ["Azure OpenAI (Codex)"],
};

export const LEGACY_BUILT_IN_PROFILE_IDS: Record<string, string[]> = {
  codex: ["openai"],
  "azure-openai": ["azure-openai-codex"],
};

export const DEFAULT_PROFILES = [
  {
    id: "anthropic",
    name: "Anthropic (Default)",
    isBuiltIn: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek (Reasoner)",
    isBuiltIn: true,
  },
  {
    id: "zai",
    name: "Z.AI (GLM-4.6)",
    isBuiltIn: true,
  },
  {
    id: "openai",
    name: "OpenAI (GPT-5.4)",
    isBuiltIn: true,
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    isBuiltIn: true,
  },
  {
    id: "minimax",
    name: "MiniMax (M2.7)",
    isBuiltIn: true,
  },
  {
    id: "kimi",
    name: "Kimi (K2.5)",
    isBuiltIn: true,
  },
];
