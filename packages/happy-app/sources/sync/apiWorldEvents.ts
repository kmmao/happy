import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";
import type { WorldEvent, WorldFilter } from "@/components/world/worldTypes";

interface WorldEventsResponse {
    events: WorldEvent[];
    total: number;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchWorldEvents(
    credentials: AuthCredentials,
    opts?: WorldFilter & { limit?: number; offset?: number },
): Promise<WorldEventsResponse> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();

    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.machineId) params.set("machineId", opts.machineId);
    if (opts?.eventTypePrefix) params.set("eventType", opts.eventTypePrefix);
    if (opts?.severity) params.set("severity", opts.severity);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/world/events${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch world events: ${response.status}`);
        }
        return (await response.json()) as WorldEventsResponse;
    });
}
