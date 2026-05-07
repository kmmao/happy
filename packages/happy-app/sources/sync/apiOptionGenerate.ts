import { AuthCredentials } from "@/auth/tokenStorage";
import { getServerUrl } from "./serverConfig";

export interface OptionGenerateResponse {
    options: string[];
    modelUsed?: string;
    provider?: string;
}

export async function generateOptionsRemote(
    credentials: AuthCredentials,
    contextSummary: string,
    sessionTitle: string | null,
    profileId: string | null,
    modelOverride: string | null,
    signal?: AbortSignal,
): Promise<OptionGenerateResponse> {
    const url = getServerUrl();

    const response = await fetch(`${url}/v1/options/generate`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ contextSummary, sessionTitle, profileId, modelOverride }),
        signal: signal ?? AbortSignal.timeout(25000),
    });

    if (!response.ok) {
        throw new Error(`Option generation failed: ${response.status}`);
    }

    return (await response.json()) as OptionGenerateResponse;
}
