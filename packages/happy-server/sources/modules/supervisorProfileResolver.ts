import { loadDecryptedProfile } from "@/modules/scoringCredentials";
import {
  BUILT_IN_PROFILE_IDS,
  getAiBackendProfileEnvironmentVariables,
} from "@/modules/aiBackendProfileEnv";
import {
  createResolvedRuntimeProfile,
  getBuiltInAIBackendProfile,
  RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
  type ResolvedRuntimeProfile,
} from "@/types/aiBackendProfile";

export interface ResolvedSupervisorProfile {
  runtimeProfile?: ResolvedRuntimeProfile;
  profileName?: string;
}

const BUILT_IN_PROFILE_ID_SET = BUILT_IN_PROFILE_IDS as ReadonlySet<string>;

function isBuiltInProfileId(profileId: string): boolean {
  return BUILT_IN_PROFILE_ID_SET.has(profileId);
}

export function parseDefaultProfileId(supervisorConfig: string | null): string | null {
  if (!supervisorConfig) return null;
  try {
    const parsed = JSON.parse(supervisorConfig) as { defaultProfileId?: string | null };
    return parsed.defaultProfileId ?? null;
  } catch {
    return null;
  }
}

export async function resolveSupervisorProfile(
  accountId: string,
  profileId: string | null | undefined,
): Promise<ResolvedSupervisorProfile> {
  if (!profileId) return {};

  const profile = await loadDecryptedProfile(accountId, profileId);
  if (profile) {
    const env = getAiBackendProfileEnvironmentVariables(profile);
    return {
      runtimeProfile: createResolvedRuntimeProfile(profile, {
        source: profile.isBuiltIn ? "built-in-profile" : "account-profile",
        trust: "trusted",
        environmentVariables: env,
      }),
      profileName: profile.name,
    };
  }

  if (isBuiltInProfileId(profileId)) {
    const builtInProfile = getBuiltInAIBackendProfile(profileId);
    if (builtInProfile) {
      return {
        runtimeProfile: createResolvedRuntimeProfile(builtInProfile, {
          source: "built-in-profile",
          trust: "trusted",
        }),
        profileName: builtInProfile.name,
      };
    }

    return {
      runtimeProfile: {
        schemaVersion: RESOLVED_RUNTIME_PROFILE_SCHEMA_VERSION,
        profileId,
        profileName: profileId,
        source: "built-in-profile",
        trust: "trusted",
        isBuiltIn: true,
        environmentVariables: {},
      },
      profileName: profileId,
    };
  }

  throw new Error(`Profile \"${profileId}\" not found`);
}
