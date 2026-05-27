import { AuthCredentials } from "@/auth/tokenStorage";
import type { AIBackendProfile } from "./settings";
import { apiRequest, apiRequestVoid } from "./apiRequest";

export interface ServerAiBackendProfile {
    profile: AIBackendProfile;
    revision: number;
    archivedAt: number | null;
}

export async function fetchAccountProfiles(
    credentials: AuthCredentials,
): Promise<ServerAiBackendProfile[]> {
    const data = await apiRequest<{ profiles: ServerAiBackendProfile[] }>(
        credentials,
        "/v1/account/profiles",
        { errorMessage: "Failed to fetch account profiles" },
    );
    return data.profiles;
}

export async function createAccountProfile(
    credentials: AuthCredentials,
    profile: AIBackendProfile,
): Promise<ServerAiBackendProfile> {
    return await apiRequest<ServerAiBackendProfile>(
        credentials,
        "/v1/account/profiles",
        {
            method: "POST",
            body: { profile },
            errorMessage: "Failed to create account profile",
        },
    );
}

export async function updateAccountProfile(
    credentials: AuthCredentials,
    profileId: string,
    profile: AIBackendProfile,
    expectedRevision: number,
): Promise<
    | { success: true; profile: AIBackendProfile; revision: number; archivedAt: number | null }
    | { success: false; error: "revision-mismatch"; current: ServerAiBackendProfile }
> {
    return await apiRequest(
        credentials,
        `/v1/account/profiles/${profileId}`,
        {
            method: "PATCH",
            body: { profile, expectedRevision },
            errorMessage: "Failed to update account profile",
        },
    );
}

export async function deleteAccountProfile(
    credentials: AuthCredentials,
    profileId: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/account/profiles/${profileId}`, {
        method: "DELETE",
        errorMessage: "Failed to delete account profile",
    });
}
