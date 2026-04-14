import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

export interface DecisionOption {
    id: string;
    description: string;
    pros?: string;
    cons?: string;
}

export interface ServerDecision {
    id: string;
    projectId: string;
    agentRole: string | null;
    sessionId: string | null;
    loopId: string | null;
    question: string;
    context: string | null;
    options: DecisionOption[];
    status: string;
    chosenOption: string | null;
    rationale: string | null;
    knowledgeId: string | null;
    precedentKey: string | null;
    assignedTo: string | null;
    assignHistory: Array<{ memberId: string; assignedAt: string; reason: string }>;
    opinions: Array<{ memberId: string; accountId: string; chosenOption: string; rationale: string | null; createdAt: string }>;
    expiresAt: number | null;
    decidedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

interface DecisionsResponse {
    decisions: ServerDecision[];
    total: number;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchDecisions(
    credentials: AuthCredentials,
    projectId: string,
    opts?: { status?: string; limit?: number; offset?: number },
): Promise<{ decisions: ServerDecision[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/decisions${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch decisions: ${response.status}`);
        }
        return (await response.json()) as DecisionsResponse;
    });
}

export async function fetchDecision(
    credentials: AuthCredentials,
    projectId: string,
    decisionId: string,
): Promise<ServerDecision> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/decisions/${decisionId}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch decision: ${response.status}`);
        }
        const data = (await response.json()) as { decision: ServerDecision };
        return data.decision;
    });
}

export async function fetchDecisionById(
    credentials: AuthCredentials,
    decisionId: string,
): Promise<ServerDecision> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/decisions/${decisionId}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch decision: ${response.status}`);
        }
        const data = (await response.json()) as { decision: ServerDecision };
        return data.decision;
    });
}

export async function adjudicateDecision(
    credentials: AuthCredentials,
    projectId: string,
    decisionId: string,
    body: { chosenOption: string; rationale?: string },
): Promise<{ decision: { id: string; status: string; knowledgeId: string | null } }> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/decisions/${decisionId}/adjudicate`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify(body),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to adjudicate decision: ${response.status}`);
        }
        return (await response.json()) as { decision: { id: string; status: string; knowledgeId: string | null } };
    });
}
