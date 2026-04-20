import {
    createResolvedRuntimeProfile,
    type ResolvedRuntimeProfile,
} from "@kmmao/happy-wire";

import { getBuiltInProfile } from "@/sync/profileUtils";
import {
    getProfileEnvironmentVariables,
    type AIBackendProfile,
} from "@/sync/settings";
import { getSupervisorDefaultProfileId } from "./supervisorProfileSelection";

export function buildSupervisorRequestProfile(
    profileId: string | null | undefined,
    profiles: AIBackendProfile[],
): {
    profileId?: string;
    runtimeProfile?: ResolvedRuntimeProfile;
} {
    const normalizedProfileId = profileId ?? undefined;
    if (!normalizedProfileId) {
        return {};
    }

    const syncedProfile = profiles.find(
        (profile) => profile.id === normalizedProfileId,
    );
    if (syncedProfile) {
        return {
            profileId: normalizedProfileId,
        };
    }

    const builtInProfile = getBuiltInProfile(normalizedProfileId);
    if (!builtInProfile) {
        return {
            profileId: normalizedProfileId,
        };
    }

    const environmentVariables = getProfileEnvironmentVariables(builtInProfile);
    return {
        profileId: normalizedProfileId,
        runtimeProfile: createResolvedRuntimeProfile(builtInProfile, {
            source: "built-in-profile",
            trust: "trusted",
            environmentVariables,
        }),
    };
}

export function buildDefaultSupervisorRequestProfile(
    supervisorConfig: string | null | undefined,
    profiles: AIBackendProfile[],
): {
    profileId?: string;
    runtimeProfile?: ResolvedRuntimeProfile;
} {
    return buildSupervisorRequestProfile(
        getSupervisorDefaultProfileId(supervisorConfig),
        profiles,
    );
}
