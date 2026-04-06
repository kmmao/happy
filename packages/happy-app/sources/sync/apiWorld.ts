import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export interface WorldDashboard {
    autonomy: {
        score: number | null;
        total30d: number;
        pending30d: number;
        decided30d: number;
        autoResolved30d: number;
        expired30d: number;
    };
    roles: {
        total: number;
        byType: Record<string, number>;
    };
    goals: {
        total: number;
        active: number;
        completed: number;
        blocked: number;
        cancelled: number;
    };
    decisions: {
        pending: number;
        recentDecided: Array<{
            id: string;
            question: string;
            chosenOption: string | null;
            decidedAt: number | null;
        }>;
    };
    lawCount: number;
    hasNarrative: boolean;
    agentMessages: {
        total30d: number;
        conflicts30d: number;
        lawSuggestions30d: number;
    };
}

export async function fetchWorldDashboard(
    credentials: AuthCredentials,
    projectId: string,
): Promise<WorldDashboard> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/world/dashboard`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch world dashboard: ${response.status}`);
        }
        return (await response.json()) as WorldDashboard;
    });
}
