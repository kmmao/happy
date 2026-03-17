import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

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
