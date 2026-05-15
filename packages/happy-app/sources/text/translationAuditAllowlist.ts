export type TranslationAllowlistContext = {
    key: string;
    langCode: string;
    value: string;
    englishValue: string;
};

export type TranslationAllowlistRule = {
    id: string;
    description: string;
    matches: (context: TranslationAllowlistContext) => boolean;
};

/**
 * Keep this file intentionally narrow.
 *
 * Allowlist is only for English strings that are intentionally stable across
 * locales: product names, technical identifiers, placeholders, and command
 * examples. Do NOT dump generic UI copy here just to silence warnings.
 */

/**
 * Product names, service names, and technical bucket labels that we intentionally
 * keep in English across locales.
 */
const PRODUCT_IDENTIFIER_KEYS = new Set<string>([
    "tabs.openclaw",
    "openclaw.title",
    "sub2api.title",
    "sessionInfo.codex",
    "sessionInfo.codexAccountChatgpt",
    "machine.tailscale",
    "machine.tailscaleIp",
    "machine.tailscaleServes",
    "settingsVoice.elevenLabsConfig",
    "settingsVoice.livekitConfig",
    "agentInput.context.sourceSdkCategories",
    "agentInput.context.sourceFallback",
    "installGuide.codexTitle",
    "installGuide.geminiTitle",
    "claudeControl.version.happyCli",
]);

const PRODUCT_IDENTIFIER_KEY_PATTERNS: RegExp[] = [
    /^agentInput\.codexModel\./,
    /^agentInput\.agent\.(claude|codex|gemini)$/,
];

/**
 * Placeholder/example literals that should remain English because they are
 * example URLs, paths, repo slugs, or machine-oriented sample values.
 */
const PLACEHOLDER_KEYS = new Set<string>([
    "common.urlPlaceholder",
    "newSession.gitRepos.repoUrlPlaceholder",
    "newSession.gitRepos.targetDirPlaceholder",
    "git.branchNamePlaceholder",
    "settingsPlugins.addPlaceholder",
    "settingsPlugins.addMarketplacePlaceholder",
    "settingsMcp.addServerNamePlaceholder",
    "gitHosts.webhookRepoUrlPlaceholder",
    "gitHosts.webhookRepoPathPlaceholder",
    "preview.urlPlaceholder",
    "sub2api.apiUrlPlaceholder",
    "sub2api.emailPlaceholder",
    "settingsVoice.livekitApiSecretPlaceholder",
    "settingsVoice.livekitApiKeyPlaceholder",
]);

const PLACEHOLDER_VALUE_PATTERNS: RegExp[] = [
    /^https?:\/\/.+/i,
    /^\/.+/,
    /^~\/.+/,
    /^[a-z0-9._-]+\/[a-z0-9._-]+$/i,
];

/**
 * Terminal or config snippets that are more useful when left verbatim.
 */
const COMMAND_EXAMPLE_KEYS = new Set<string>([
    "settingsMcp.addServerCommandPlaceholder",
    "openclaw.tokenCommandValue",
]);

const COMMAND_EXAMPLE_VALUE_PATTERNS: RegExp[] = [
    /^[A-Z_]+=.+/m,
    /^(npx|npm|pnpm|yarn|bun|tsx|node|python|pip|git|clawdbot)\b/i,
];

export const TRANSLATION_AUDIT_ALLOWLIST: TranslationAllowlistRule[] = [
    {
        id: "english-product-identifiers",
        description: "Keep product names, service names, and model identifiers in English.",
        matches: ({ key }) =>
            PRODUCT_IDENTIFIER_KEYS.has(key) ||
            PRODUCT_IDENTIFIER_KEY_PATTERNS.some((pattern) => pattern.test(key)),
    },
    {
        id: "english-placeholder-literals",
        description: "Keep example URLs, paths, repo slugs, and placeholder literals in English.",
        matches: ({ key, englishValue }) =>
            PLACEHOLDER_KEYS.has(key) ||
            PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(englishValue)),
    },
    {
        id: "english-command-examples",
        description: "Keep command examples and terminal-oriented snippets verbatim in English.",
        matches: ({ key, englishValue }) =>
            COMMAND_EXAMPLE_KEYS.has(key) ||
            COMMAND_EXAMPLE_VALUE_PATTERNS.some((pattern) => pattern.test(englishValue)),
    },
];

export function isAllowlistedTranslation(
    context: TranslationAllowlistContext,
): boolean {
    return TRANSLATION_AUDIT_ALLOWLIST.some((rule) => rule.matches(context));
}
