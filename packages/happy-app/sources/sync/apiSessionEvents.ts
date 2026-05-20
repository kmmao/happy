import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import { getServerUrl } from "./serverConfig";

export interface ServerSessionEvent {
    id: string;
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt: number;
}

interface SessionEventsListResponse {
    events: ServerSessionEvent[];
    total: number;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchSessionEvents(
    credentials: AuthCredentials,
    sessionId: string,
    opts?: {
        eventType?: string;
        limit?: number;
        offset?: number;
    },
): Promise<{ events: ServerSessionEvent[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.eventType) params.set("eventType", opts.eventType);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/sessions/${sessionId}/events${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        throwIfNotOk(response, 'Failed to fetch session events');
        return (await response.json()) as SessionEventsListResponse;
    });
}
