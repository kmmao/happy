import { AuthCredentials } from "@/auth/tokenStorage";
import { getCurrentLanguage, type SupportedLanguage } from "@/text";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

/** Maps app appearance language to world generation copy (en | zh). */
export function worldContentLanguageForGenerate(): "en" | "zh" {
    const code: SupportedLanguage = getCurrentLanguage();
    return code === "zh-Hans" || code === "zh-Hant" ? "zh" : "en";
}

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

export interface WorldGenerateResult {
    narrative: string | null;
    laws: Array<{
        id: string;
        category: string;
        description: string;
        enabled: boolean;
        severity: string;
    }> | null;
    roles: Array<{
        id: string;
        name: string;
        type: string;
        description: string;
        duties: string[];
    }> | null;
    goals: null;
    skipped: string[];
    errors: string[];
}

export async function generateWorld(
    credentials: AuthCredentials,
    projectId: string,
    opts: { mode: "auto" | "custom"; prompt?: string; contentLanguage?: "en" | "zh" },
): Promise<WorldGenerateResult> {
    const API_ENDPOINT = getServerUrl();
    const contentLanguage = opts.contentLanguage ?? worldContentLanguageForGenerate();
    const response = await fetch(
        `${API_ENDPOINT}/v1/projects/${projectId}/world/generate`,
        {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify({ ...opts, contentLanguage }),
        },
    );
    if (!response.ok) {
        throw new Error(`Failed to generate world: ${response.status}`);
    }
    return (await response.json()) as WorldGenerateResult;
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
