import { parseRequestedSupervisorProfileId } from "@/modules/supervisorRequestProfile";
import {
    parseDefaultProfileId,
    resolveSupervisorProfile,
    type ResolvedSupervisorProfile,
} from "@/modules/supervisorProfileResolver";

export interface ResolveConfiguredSupervisorProfileInput {
    userId: string;
    supervisorConfig: string | null;
    profileId?: string | null;
    runtimeProfile?: unknown;
}

export type ResolveConfiguredSupervisorProfileResult =
    | {
          ok: true;
          resolvedProfile: ResolvedSupervisorProfile;
      }
    | {
          ok: false;
          error: string;
      };

export async function resolveConfiguredSupervisorProfile(
    input: ResolveConfiguredSupervisorProfileInput,
): Promise<ResolveConfiguredSupervisorProfileResult> {
    const requestedProfile = parseRequestedSupervisorProfileId({
        profileId: input.profileId,
        runtimeProfile: input.runtimeProfile,
    });
    if (!requestedProfile.ok) {
        return requestedProfile;
    }

    const requestedProfileId =
        requestedProfile.profileId ??
        parseDefaultProfileId(input.supervisorConfig);
    const resolvedProfile = await resolveSupervisorProfile(
        input.userId,
        requestedProfileId,
    );

    return {
        ok: true,
        resolvedProfile,
    };
}
