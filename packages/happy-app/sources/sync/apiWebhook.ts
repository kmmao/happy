import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

export interface CiRun {
    runId: number;
    name: string;
    branch: string;
    sha: string;
    status: string;            // "queued" | "in_progress" | "completed"
    conclusion: string | null; // "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | null
    url: string;
    triggerEvent: string;
    createdAt: string;         // ISO 8601
    updatedAt: string;         // ISO 8601
}

export interface WebhookEvent {
    id: string;
    provider: string;
    repoUrl: string;
    issueNumber: number;
    issueTitle: string;
    issueUrl: string;
    status: string; // "pending" | "dispatched" | "completed" | "failed" | "skipped"
    errorMessage: string | null;
    createdAt: number;
}

export async function fetchCiRuns(
    credentials: AuthCredentials,
    params?: { projectId?: string; repoUrl?: string },
): Promise<{ runs: CiRun[] }> {
    const API_ENDPOINT = getServerUrl();
    const query = new URLSearchParams();
    if (params?.projectId) query.set("projectId", params.projectId);
    if (params?.repoUrl) query.set("repoUrl", params.repoUrl);
    const qs = query.toString() ? `?${query.toString()}` : "";

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/ci/runs${qs}`, {
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch CI runs: ${response.status}`);
        }
        return (await response.json()) as { runs: CiRun[] };
    });
}

export async function fetchWebhookEvents(
    credentials: AuthCredentials,
    params?: { projectId?: string; limit?: number; offset?: number },
): Promise<{ events: WebhookEvent[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const query = new URLSearchParams();
    if (params?.projectId) query.set("projectId", params.projectId);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/webhooks/events${qs}`,
            {
                headers: {
                    Authorization: `Bearer ${credentials.token}`,
                    "Content-Type": "application/json",
                },
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch webhook events: ${response.status}`);
        }
        return (await response.json()) as { events: WebhookEvent[]; total: number };
    });
}
