import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest } from "./apiRequest";

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

export async function fetchSessionEvents(
    credentials: AuthCredentials,
    sessionId: string,
    opts?: {
        eventType?: string;
        limit?: number;
        offset?: number;
    },
): Promise<{ events: ServerSessionEvent[]; total: number }> {
    return await apiRequest<SessionEventsListResponse>(
        credentials,
        `/v1/sessions/${sessionId}/events`,
        {
            query: {
                eventType: opts?.eventType || undefined,
                limit: opts?.limit || undefined,
                offset: opts?.offset || undefined,
            },
            errorMessage: "Failed to fetch session events",
        },
    );
}
