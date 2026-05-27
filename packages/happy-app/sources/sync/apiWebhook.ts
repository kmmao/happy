import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest } from "./apiRequest";

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
    return await apiRequest<{ runs: CiRun[] }>(credentials, "/v1/ci/runs", {
        query: {
            projectId: params?.projectId || undefined,
            repoUrl: params?.repoUrl || undefined,
        },
        errorMessage: 'Failed to fetch CI runs',
    });
}

export async function fetchWebhookEvents(
    credentials: AuthCredentials,
    params?: { projectId?: string; limit?: number; offset?: number },
): Promise<{ events: WebhookEvent[]; total: number }> {
    return await apiRequest<{ events: WebhookEvent[]; total: number }>(credentials, "/v1/webhooks/events", {
        query: {
            projectId: params?.projectId || undefined,
            limit: params?.limit,
            offset: params?.offset,
        },
        errorMessage: 'Failed to fetch webhook events',
    });
}
