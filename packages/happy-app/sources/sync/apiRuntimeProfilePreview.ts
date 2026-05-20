import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import { getServerUrl } from "./serverConfig";

export type RuntimeProfilePreviewPurpose =
    | "supervisor"
    | "webhook"
    | "cron"
    | "task-manual"
    | "task-retry"
    | "research"
    | "health";

export type RuntimeProfileSource = "explicit" | "project-default";
export type RuntimeProfileFailureReason =
    | "missing"
    | "not-found"
    | "decrypt-failed"
    | "empty";

export interface RuntimeProfilePreviewOk {
    ok: true;
    profileId: string;
    profileName: string | null;
    profileSource: RuntimeProfileSource;
    purpose: RuntimeProfilePreviewPurpose;
}

export interface RuntimeProfilePreviewFailure {
    ok: false;
    reason: RuntimeProfileFailureReason;
    message: string;
    profileId: string | null;
    purpose: RuntimeProfilePreviewPurpose;
}

export type RuntimeProfilePreviewResult =
    | RuntimeProfilePreviewOk
    | RuntimeProfilePreviewFailure;

/**
 * Fetch the "what profile would this actually resolve to?" preview for a
 * given project + purpose. Read-only — does NOT trigger the server-side
 * Inbox notification on failure (see server C6 route design).
 */
export async function fetchRuntimeProfilePreview(
    credentials: AuthCredentials,
    projectId: string,
    purpose: RuntimeProfilePreviewPurpose,
): Promise<RuntimeProfilePreviewResult> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/runtime-profile/preview?purpose=${encodeURIComponent(purpose)}`,
            {
                headers: {
                    Authorization: `Bearer ${credentials.token}`,
                },
            },
        );
        throwIfNotOk(response, 'Failed to fetch runtime profile preview');
        return (await response.json()) as RuntimeProfilePreviewResult;
    });
}
