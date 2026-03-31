import type { AIBackendProfile } from "@/sync/settings";

export const PROFILES_NEEDING_KEYS = [
    "openai",
    "azure-openai",
    "azure-openai-codex",
    "zai",
    "microsoft",
    "deepseek",
    "kimi",
];

export function profileNeedsConfiguration(
    profileId: string | null,
    allProfiles: AIBackendProfile[],
): boolean {
    if (!profileId) return false; // Manual configuration doesn't need API keys
    const profile = allProfiles.find((p) => p.id === profileId);
    if (!profile) return false;

    return PROFILES_NEEDING_KEYS.includes(profile.id);
}

export interface ProfileRequiredField {
    key: string;
    label: string;
    placeholder: string;
    isPassword?: boolean;
}

export function getProfileRequiredFields(
    profileId: string | null,
    allProfiles: AIBackendProfile[],
): ProfileRequiredField[] {
    if (!profileId) return [];
    const profile = allProfiles.find((p) => p.id === profileId);
    if (!profile) return [];

    switch (profile.id) {
        case "deepseek":
            return [
                {
                    key: "ANTHROPIC_AUTH_TOKEN",
                    label: "DeepSeek API Key",
                    placeholder: "DEEPSEEK_API_KEY",
                    isPassword: true,
                },
            ];
        case "openai":
            return [
                {
                    key: "OPENAI_API_KEY",
                    label: "OpenAI API Key",
                    placeholder: "sk-...",
                    isPassword: true,
                },
            ];
        case "azure-openai":
            return [
                {
                    key: "AZURE_OPENAI_API_KEY",
                    label: "Azure OpenAI API Key",
                    placeholder: "Enter your Azure OpenAI API key",
                    isPassword: true,
                },
                {
                    key: "AZURE_OPENAI_ENDPOINT",
                    label: "Azure Endpoint",
                    placeholder: "https://your-resource.openai.azure.com/",
                },
                {
                    key: "AZURE_OPENAI_DEPLOYMENT_NAME",
                    label: "Deployment Name",
                    placeholder: "gpt-4-turbo",
                },
            ];
        case "zai":
            return [
                {
                    key: "ANTHROPIC_AUTH_TOKEN",
                    label: "Z.ai API Key",
                    placeholder: "Z_AI_API_KEY",
                    isPassword: true,
                },
            ];
        case "kimi":
            return [
                {
                    key: "ANTHROPIC_AUTH_TOKEN",
                    label: "Kimi API Key",
                    placeholder: "KIMI_API_KEY",
                    isPassword: true,
                },
            ];
        case "microsoft":
            return [
                {
                    key: "AZURE_OPENAI_API_KEY",
                    label: "Azure API Key",
                    placeholder: "Enter your Azure API key",
                    isPassword: true,
                },
                {
                    key: "AZURE_OPENAI_ENDPOINT",
                    label: "Azure Endpoint",
                    placeholder: "https://your-resource.openai.azure.com/",
                },
                {
                    key: "AZURE_OPENAI_DEPLOYMENT_NAME",
                    label: "Deployment Name",
                    placeholder: "gpt-4-turbo",
                },
            ];
        case "azure-openai-codex":
            return [
                {
                    key: "AZURE_OPENAI_API_KEY",
                    label: "Azure OpenAI API Key",
                    placeholder: "Enter your Azure OpenAI API key",
                    isPassword: true,
                },
                {
                    key: "AZURE_OPENAI_ENDPOINT",
                    label: "Azure Endpoint",
                    placeholder: "https://your-resource.openai.azure.com/",
                },
                {
                    key: "AZURE_OPENAI_DEPLOYMENT_NAME",
                    label: "Deployment Name",
                    placeholder: "gpt-4-turbo",
                },
            ];
        default:
            return [];
    }
}

export const BUILT_IN_PROFILES: AIBackendProfile[] = [
    {
        id: "anthropic",
        name: "Anthropic (Default)",
        description: "Default Claude configuration",
        anthropicConfig: {},
        environmentVariables: [],
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "deepseek",
        name: "DeepSeek (Reasoner)",
        description: "DeepSeek reasoning model with proxy to Anthropic API",
        anthropicConfig: {
            baseUrl: "https://api.deepseek.com/anthropic",
            model: "deepseek-reasoner",
        },
        environmentVariables: [
            { name: "API_TIMEOUT_MS", value: "600000" },
            { name: "ANTHROPIC_SMALL_FAST_MODEL", value: "deepseek-chat" },
            { name: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", value: "1" },
        ],
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "openai",
        name: "OpenAI (GPT-4/Codex)",
        description: "OpenAI GPT-4 and Codex models",
        openaiConfig: {
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4-turbo",
        },
        environmentVariables: [],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "azure-openai-codex",
        name: "Azure OpenAI (Codex)",
        description: "Microsoft Azure OpenAI for Codex agents",
        azureOpenAIConfig: {
            endpoint: "https://your-resource.openai.azure.com/",
            apiVersion: "2024-02-15-preview",
            deploymentName: "gpt-4-turbo",
        },
        environmentVariables: [],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "azure-openai",
        name: "Azure OpenAI",
        description: "Microsoft Azure OpenAI configuration",
        azureOpenAIConfig: {
            apiVersion: "2024-02-15-preview",
        },
        environmentVariables: [
            { name: "AZURE_OPENAI_API_VERSION", value: "2024-02-15-preview" },
        ],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "zai",
        name: "Z.ai (GLM-4.6)",
        description: "Z.ai GLM-4.6 model with proxy to Anthropic API",
        anthropicConfig: {
            baseUrl: "https://api.z.ai/api/anthropic",
            model: "glm-4.6",
        },
        environmentVariables: [],
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "microsoft",
        name: "Microsoft Azure",
        description: "Microsoft Azure AI services",
        openaiConfig: {
            baseUrl: "https://api.openai.azure.com",
            model: "gpt-4-turbo",
        },
        environmentVariables: [],
        compatibility: { claude: false, codex: true, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
    {
        id: "kimi",
        name: "Kimi (K2.5)",
        description: "Moonshot Kimi model with Anthropic-compatible endpoint",
        anthropicConfig: {
            baseUrl: "https://api.moonshot.ai/anthropic",
            model: "kimi-k2.5",
        },
        environmentVariables: [
            { name: "API_TIMEOUT_MS", value: "3000000" },
            { name: "ENABLE_TOOL_SEARCH", value: "false" },
        ],
        compatibility: { claude: true, codex: false, gemini: false },
        isBuiltIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: "1.0.0",
    },
];
