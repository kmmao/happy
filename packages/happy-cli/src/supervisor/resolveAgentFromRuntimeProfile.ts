import { readSettings } from "@/persistence";
import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";

export type AgentResolution =
  | { agent: "claude" | "codex"; error?: undefined }
  | { agent?: undefined; error: string };

/**
 * Determine the agent type (claude or codex) from a resolved runtime profile.
 * Does NOT support an explicit agent override — use resolveAgentForSupervisor
 * when the caller can supply one.
 */
export async function resolveAgentFromRuntimeProfile(
  runtimeProfile: ResolvedRuntimeProfile | undefined,
): Promise<AgentResolution> {
  const compat = runtimeProfile?.compatibility;
  const profileName = runtimeProfile?.profileName ?? runtimeProfile?.profileId ?? "unknown";

  if (compat) {
    if (compat.codex === true && compat.claude === false) return { agent: "codex" };
    if (compat.claude === true && compat.codex === false) return { agent: "claude" };
    if (compat.claude === true && compat.codex === true) return { agent: "claude" };
    if (compat.claude === false && compat.codex === false) {
      return { error: `Profile "${profileName}" is not compatible with either Claude or Codex` };
    }
  }

  const env = runtimeProfile?.environmentVariables ?? {};

  if (env.HAPPY_CODEX_BACKEND || env.HAPPY_CODEX_CONFIG_MODE || env.HAPPY_CODEX_MODEL) {
    return { agent: "codex" };
  }

  if (env.OPENAI_BASE_URL || env.OPENAI_MODEL || env.AZURE_OPENAI_API_VERSION || env.AZURE_OPENAI_DEPLOYMENT_NAME) {
    return { agent: "codex" };
  }

  const profileId = runtimeProfile?.profileId;
  if (profileId) {
    try {
      const settings = await readSettings();
      const profile = settings.profiles.find((p) => p.id === profileId);
      if (profile?.codexConfig) return { agent: "codex" };
      if (profile?.compatibility?.codex === true && profile?.compatibility?.claude === false) {
        return { agent: "codex" };
      }
      if (profile?.compatibility?.claude === false) {
        return {
          error: `Profile "${profileName}" is not compatible with Claude and agent type could not be determined`,
        };
      }
    } catch {
      // settings read failed — continue to default
    }
  }

  return { agent: "claude" };
}
