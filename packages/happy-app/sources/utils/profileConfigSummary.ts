import type { AIBackendProfile } from "@/sync/settings";
import { getProfileEnvironmentVariables } from "@/sync/settings";
import { resolveEnvVarSubstitution } from "@/hooks/envVarUtils";

interface ProfileConfigSummaryOptions {
  daemonEnv?: Record<string, string | null>;
  includeTmux?: boolean;
}

const MODEL_ENV_KEYS = [
  "HAPPY_CODEX_PROFILE",
  "HAPPY_CODEX_MODEL",
  "ANTHROPIC_MODEL",
  "OPENAI_MODEL",
  "AZURE_OPENAI_DEPLOYMENT_NAME",
  "TOGETHER_MODEL",
] as const;

const HOST_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_ENDPOINT",
] as const;

function getResolvedEnvValue(
  envVars: Record<string, string>,
  key: string,
  daemonEnv: Record<string, string | null>,
): string | null {
  const rawValue = envVars[key]?.trim();
  if (!rawValue) {
    return null;
  }

  const resolvedValue = resolveEnvVarSubstitution(rawValue, daemonEnv)?.trim();
  if (resolvedValue) {
    return resolvedValue;
  }

  return rawValue;
}

function getFirstResolvedValue(
  envVars: Record<string, string>,
  keys: readonly string[],
  daemonEnv: Record<string, string | null>,
): string | null {
  for (const key of keys) {
    const value = getResolvedEnvValue(envVars, key, daemonEnv);
    if (value) {
      return value;
    }
  }

  return null;
}

function getHostnameSummary(
  envVars: Record<string, string>,
  daemonEnv: Record<string, string | null>,
): string | null {
  const value = getFirstResolvedValue(envVars, HOST_ENV_KEYS, daemonEnv);
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function getProfileConfigSummary(
  profile: AIBackendProfile,
  options: ProfileConfigSummaryOptions = {},
): string {
  const daemonEnv = options.daemonEnv ?? {};
  const envVars = getProfileEnvironmentVariables(profile);
  const parts: string[] = [];

  const modelOrProfileValue = getFirstResolvedValue(
    envVars,
    MODEL_ENV_KEYS,
    daemonEnv,
  );
  if (modelOrProfileValue) {
    parts.push(modelOrProfileValue);
  }

  const hostValue = getHostnameSummary(envVars, daemonEnv);
  if (hostValue) {
    parts.push(hostValue);
  }

  if (options.includeTmux) {
    const tmuxSession = profile.tmuxConfig?.sessionName?.trim();
    if (tmuxSession) {
      parts.push(`tmux: ${tmuxSession}`);
    }

    const tmuxTmpDir = profile.tmuxConfig?.tmpDir?.trim();
    if (tmuxTmpDir) {
      parts.push(`dir: ${tmuxTmpDir}`);
    }
  }

  return Array.from(new Set(parts)).join(", ");
}
