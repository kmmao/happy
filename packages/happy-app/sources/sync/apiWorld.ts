import {
    type SuggestionBucket,
    type SuggestionEvidence,
    type SuggestionPayload,
    type SuggestionSummary,
    type SuggestionStatus,
    type SuggestionType,
    type AutonomyStats,
} from "@kmmao/happy-wire";
export type {
    SuggestionBucket,
    SuggestionEvidence,
    SuggestionPayload,
    SuggestionSummary,
    SuggestionStatus,
    SuggestionType,
    AutonomyStats,
};
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
    goalHealth: {
        averageScore: number | null;
        criticalCount: number;
        warningCount: number;
        healthyCount: number;
        byLayer: {
            strategic: { count: number; avgScore: number | null };
            operational: { count: number; avgScore: number | null };
            execution: { count: number; avgScore: number | null };
        };
    };
    lawCount: number;
    hasNarrative: boolean;
    agentMessages: {
        total30d: number;
        conflicts30d: number;
        lawSuggestions30d: number;
        handoffs30d: number;
        dependencyBlocked30d: number;
        reviewRequests30d: number;
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

export async function fetchSuggestions(
    credentials: AuthCredentials,
    projectId: string,
    opts?: {
        goalId?: string;
        bucket?: SuggestionBucket;
        status?: SuggestionStatus;
    },
): Promise<SuggestionSummary[]> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const params = new URLSearchParams();
        params.set("status", opts?.status ?? "open");
        if (opts?.goalId) params.set("goalId", opts.goalId);
        if (opts?.bucket) params.set("bucket", opts.bucket);
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/world/suggestions?${params.toString()}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch suggestions: ${response.status}`);
        }
        const data = (await response.json()) as { suggestions: SuggestionSummary[] };
        return data.suggestions;
    });
}

export async function refreshSuggestions(
    credentials: AuthCredentials,
    projectId: string,
): Promise<{ created: number; unchanged: number; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(
        `${API_ENDPOINT}/v1/projects/${projectId}/world/suggestions/refresh`,
        { method: "POST", headers: authHeaders(credentials) },
    );
    if (!response.ok) {
        throw new Error(`Failed to refresh suggestions: ${response.status}`);
    }
    return (await response.json()) as { created: number; unchanged: number; total: number };
}

export interface AcceptSuggestionResult {
    suggestionId: string;
    createdEntityType: "goal" | "task" | "skill" | "decision";
    createdEntityId: string;
    machineId?: string;
}

export async function acceptSuggestion(
    credentials: AuthCredentials,
    projectId: string,
    suggestionId: string,
    body?: { machineId?: string; priorityOverride?: string; roleOverride?: string },
): Promise<AcceptSuggestionResult> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(
        `${API_ENDPOINT}/v1/projects/${projectId}/world/suggestions/${suggestionId}/accept`,
        { method: "POST", headers: authHeaders(credentials), body: JSON.stringify(body ?? {}) },
    );
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Failed to accept suggestion: ${response.status}`);
    }
    return (await response.json()) as AcceptSuggestionResult;
}

export async function dismissSuggestion(
    credentials: AuthCredentials,
    projectId: string,
    suggestionId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(
        `${API_ENDPOINT}/v1/projects/${projectId}/world/suggestions/${suggestionId}/dismiss`,
        { method: "POST", headers: authHeaders(credentials) },
    );
    if (!response.ok) {
        throw new Error(`Failed to dismiss suggestion: ${response.status}`);
    }
}

export interface CollaborationRoleEntry {
    roleName: string;
    roleType: string;
    activeTasks: number;
    pendingMessages: number;
    blockedOn: Array<{
        waitingFor: string;
        reason: string;
        messageId: string;
        relatedGoalId: string | null;
        since: number;
    }>;
    pendingHandoffs: number;
    pendingReviews: number;
}

export interface CollaborationSummary {
    roles: CollaborationRoleEntry[];
    openConflicts: number;
    pendingDecisions: number;
    blockedChains: Array<{ chain: string[]; rootCause: string }>;
}

export async function fetchCollaboration(
    credentials: AuthCredentials,
    projectId: string,
): Promise<CollaborationSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/world/collaboration`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch collaboration: ${response.status}`);
        }
        return (await response.json()) as CollaborationSummary;
    });
}

export async function fetchAutonomyStats(
    credentials: AuthCredentials,
    projectId: string,
): Promise<AutonomyStats> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/world/autonomy-stats`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch autonomy stats: ${response.status}`);
        }
        return (await response.json()) as AutonomyStats;
    });
}
