import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import type { AIBackendProfile } from "./settings";
import { getServerUrl } from "./serverConfig";

export interface ServerAiBackendProfile {
    profile: AIBackendProfile;
    revision: number;
    archivedAt: number | null;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchAccountProfiles(
    credentials: AuthCredentials,
): Promise<ServerAiBackendProfile[]> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/account/profiles`, {
            headers: authHeaders(credentials),
        });

        throwIfNotOk(response, 'Failed to fetch account profiles');

        const data = (await response.json()) as {
            profiles: ServerAiBackendProfile[];
        };
        return data.profiles;
    });
}

export async function createAccountProfile(
    credentials: AuthCredentials,
    profile: AIBackendProfile,
): Promise<ServerAiBackendProfile> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/account/profiles`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify({ profile }),
        });

        throwIfNotOk(response, 'Failed to create account profile');

        return (await response.json()) as ServerAiBackendProfile;
    });
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
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/account/profiles/${profileId}`, {
            method: "PATCH",
            headers: authHeaders(credentials),
            body: JSON.stringify({ profile, expectedRevision }),
        });

        throwIfNotOk(response, 'Failed to update account profile');

        return (await response.json()) as
            | { success: true; profile: AIBackendProfile; revision: number; archivedAt: number | null }
            | { success: false; error: "revision-mismatch"; current: ServerAiBackendProfile };
    });
}

export async function deleteAccountProfile(
    credentials: AuthCredentials,
    profileId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/account/profiles/${profileId}`, {
            method: "DELETE",
            headers: authHeaders(credentials),
        });

        throwIfNotOk(response, 'Failed to delete account profile');
    });
}
