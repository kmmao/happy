import { AuthCredentials } from "@/auth/tokenStorage";
import { throwIfNotOk } from "@/utils/http";
import { getServerUrl } from "./serverConfig";

export interface OptionScoreResponse {
    scores: number[];
    cached: boolean;
    modelUsed?: string;
    provider?: string;
}

export async function scoreOptionsRemote(
    credentials: AuthCredentials,
    options: string[],
    contextSummary: string,
    sessionTitle: string | null,
    profileId: string | null,
    modelOverride: string | null,
    signal?: AbortSignal,
): Promise<OptionScoreResponse> {
    const url = getServerUrl();

    const response = await fetch(`${url}/v1/options/score`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ options, contextSummary, sessionTitle, profileId, modelOverride }),
        signal: signal ?? AbortSignal.timeout(18000),
    });

    throwIfNotOk(response, 'Option scoring failed');

    return (await response.json()) as OptionScoreResponse;
}
