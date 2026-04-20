import {
    BUILT_IN_AI_BACKEND_PROFILE_IDS,
    isTrustedRuntimeProfile,
    normalizeResolvedRuntimeProfile,
} from "@/types/aiBackendProfile";

const BUILT_IN_PROFILE_ID_SET =
    BUILT_IN_AI_BACKEND_PROFILE_IDS as ReadonlySet<string>;

const INVALID_RUNTIME_PROFILE_ERROR =
    "Supervisor runtime profile payload is invalid or unsupported";

export function parseRequestedSupervisorProfileId(input: {
    profileId?: string | null;
    runtimeProfile?: unknown;
}):
    | {
          ok: true;
          profileId: string | null;
      }
    | {
          ok: false;
          error: string;
      } {
    const normalizedRuntimeProfile = normalizeResolvedRuntimeProfile(
        input.runtimeProfile,
    );
    if (input.runtimeProfile && !normalizedRuntimeProfile) {
        return {
            ok: false,
            error: INVALID_RUNTIME_PROFILE_ERROR,
        };
    }

    const requestedProfileId =
        input.profileId ?? normalizedRuntimeProfile?.profileId ?? null;
    if (!normalizedRuntimeProfile) {
        return {
            ok: true,
            profileId: requestedProfileId,
        };
    }

    if (
        !requestedProfileId ||
        normalizedRuntimeProfile.profileId !== requestedProfileId ||
        normalizedRuntimeProfile.source !== "built-in-profile" ||
        normalizedRuntimeProfile.isBuiltIn !== true ||
        !isTrustedRuntimeProfile(normalizedRuntimeProfile) ||
        !BUILT_IN_PROFILE_ID_SET.has(normalizedRuntimeProfile.profileId)
    ) {
        return {
            ok: false,
            error: INVALID_RUNTIME_PROFILE_ERROR,
        };
    }

    return {
        ok: true,
        profileId: requestedProfileId,
    };
}
