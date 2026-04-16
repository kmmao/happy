import type { SpawnSessionOptions } from "@/modules/common/registerCommonHandlers";
import {
  isTrustedRuntimeProfile,
  normalizeResolvedRuntimeProfile,
} from "@kmmao/happy-wire";

const OPERATOR_ONLY_ENV_VARS = new Set([
  // Anthropic
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  // OpenAI / Codex
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  // Google / Gemini
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  // Other providers
  "TOGETHER_API_KEY",
  "CODEX_HOME",
  // OAuth
  "CLAUDE_CODE_OAUTH_TOKEN",
  // Server internals that must never leak
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "GITHUB_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
]);

type ProfileTrustInput = Pick<
  SpawnSessionOptions,
  "profileId" | "automationContext" | "runtimeProfile"
>;

export function isTrustedProfileEnvironment(input: ProfileTrustInput): boolean {
  if (input.runtimeProfile) {
    return isTrustedRuntimeProfile(
      normalizeResolvedRuntimeProfile(input.runtimeProfile),
    );
  }
  if (input.profileId) return true;
  return input.automationContext?.kind === "supervisor";
}

export function filterGuiEnvironmentVariables(
  rawEnvironmentVariables: Record<string, string | undefined>,
  input: ProfileTrustInput,
  daemonEnvironment: NodeJS.ProcessEnv = process.env,
): {
  environmentVariables: Record<string, string>;
  stripped: string[];
  trusted: boolean;
} {
  const trusted = isTrustedProfileEnvironment(input);
  const stripped: string[] = [];
  const environmentVariables = Object.fromEntries(
    Object.entries(rawEnvironmentVariables).filter(
      (entry): entry is [string, string] => {
        if (entry[1] === undefined) return false;
        if (
          !trusted &&
          OPERATOR_ONLY_ENV_VARS.has(entry[0]) &&
          daemonEnvironment[entry[0]]
        ) {
          stripped.push(entry[0]);
          return false;
        }
        return true;
      },
    ),
  );

  return {
    environmentVariables,
    stripped,
    trusted,
  };
}
