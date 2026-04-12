export type CodexConfigMode =
  | "inherit"
  | "managed-profile"
  | "managed-overrides";

export interface ResolvedCodexRuntimeConfig {
  configMode: CodexConfigMode;
  profileName?: string;
  overrides: {
    model?: string;
    reasoningEffort?: string;
    reasoningSummary?: string;
    verbosity?: string;
    personality?: string;
    serviceTier?: string;
    webSearch?: "disabled" | "cached" | "live";
    approvalPolicy?: string;
    sandboxMode?: string;
  };
}

export function resolveCodexRuntimeConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ResolvedCodexRuntimeConfig {
  const rawConfigMode = env.HAPPY_CODEX_CONFIG_MODE?.trim();
  const configMode: CodexConfigMode =
    rawConfigMode === "managed-profile" ||
    rawConfigMode === "managed-overrides"
      ? rawConfigMode
      : "inherit";

  const webSearchRaw = env.HAPPY_CODEX_WEB_SEARCH?.trim();
  const webSearch =
    webSearchRaw === "disabled" ||
    webSearchRaw === "cached" ||
    webSearchRaw === "live"
      ? webSearchRaw
      : undefined;

  return {
    configMode,
    profileName: env.HAPPY_CODEX_PROFILE?.trim() || undefined,
    overrides: {
      model: env.HAPPY_CODEX_MODEL?.trim() || undefined,
      reasoningEffort: env.HAPPY_CODEX_REASONING_EFFORT?.trim() || undefined,
      reasoningSummary:
        env.HAPPY_CODEX_REASONING_SUMMARY?.trim() || undefined,
      verbosity: env.HAPPY_CODEX_VERBOSITY?.trim() || undefined,
      personality: env.HAPPY_CODEX_PERSONALITY?.trim() || undefined,
      serviceTier: env.HAPPY_CODEX_SERVICE_TIER?.trim() || undefined,
      webSearch,
      approvalPolicy: env.HAPPY_CODEX_APPROVAL_POLICY?.trim() || undefined,
      sandboxMode: env.HAPPY_CODEX_SANDBOX_MODE?.trim() || undefined,
    },
  };
}
