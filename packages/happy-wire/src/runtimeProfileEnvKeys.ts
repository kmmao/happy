/**
 * Canonical env variable names for runtime-profile fields that cannot be
 * expressed via AIBackendProfile.environmentVariables / codexConfig.
 *
 * Used for Claude-specific runtime behavior (extended thinking, max turns,
 * permission mode). Server encodes these before spawning a session; CLI reads
 * them when constructing Claude Agent SDK options.
 *
 * All values are encoded as strings since env is stringly-typed. Consumers must
 * parse booleans/integers explicitly.
 */
export const HAPPY_PROFILE_ENV_KEYS = {
  /** `"true" | "false"` — toggle Claude extended thinking */
  claudeThinkingEnabled: "HAPPY_CLAUDE_THINKING_ENABLED",
  /** integer as string — Claude extended thinking budget tokens */
  claudeThinkingBudgetTokens: "HAPPY_CLAUDE_THINKING_BUDGET_TOKENS",
  /** integer as string — max conversation turns before stop */
  maxTurns: "HAPPY_MAX_TURNS",
  /** DefaultPermissionMode literal — permission mode override */
  permissionMode: "HAPPY_PERMISSION_MODE",
} as const;

export type HappyProfileEnvKey =
  (typeof HAPPY_PROFILE_ENV_KEYS)[keyof typeof HAPPY_PROFILE_ENV_KEYS];
