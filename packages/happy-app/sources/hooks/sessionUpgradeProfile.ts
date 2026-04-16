import { createResolvedRuntimeProfile } from "@kmmao/happy-wire";

import type { machineSpawnNewSession } from "@/sync/ops";
import { getBuiltInProfile } from "@/sync/profileUtils";
import { getProfileEnvironmentVariables, type AIBackendProfile } from "@/sync/settings";
import type { Session } from "@/sync/storageTypes";

function findSessionProfile(
    session: Session,
    profiles: AIBackendProfile[],
): AIBackendProfile | null {
    if (!session.profileId) {
        return null;
    }

    return (
        profiles.find((profile) => profile.id === session.profileId) ??
        getBuiltInProfile(session.profileId)
    );
}

export function buildSessionRespawnProfile(
    session: Session,
    profiles: AIBackendProfile[],
): Pick<
    Parameters<typeof machineSpawnNewSession>[0],
    "profileId" | "runtimeProfile" | "environmentVariables"
> {
    const profile = findSessionProfile(session, profiles);
    if (!profile) {
        return {
            profileId: session.profileId ?? undefined,
        };
    }

    const environmentVariables = getProfileEnvironmentVariables(profile);
    const runtimeProfile = createResolvedRuntimeProfile(profile, {
        source: profile.isBuiltIn ? "built-in-profile" : "account-profile",
        trust: "trusted",
        environmentVariables,
    });

    return {
        profileId: profile.id,
        runtimeProfile,
        environmentVariables,
    };
}
