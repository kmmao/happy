/**
 * App-side client for the server-managed generic AgentLoop endpoints
 * (ADR-0022 Phase 3b). Mirrors `apiWebhookTriggers.ts` shape so the
 * Workflow modals + workflow list can reuse the same patterns.
 *
 * Endpoints live under `/v1/projects/:projectId/agent-loops`. Server
 * code lives in packages/happy-server/sources/app/api/routes/agentLoopRoutes.ts.
 */

import type { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest, apiRequestVoid } from "./apiRequest";
import type {
    CreateGenericAgentLoopBody,
    UpdateGenericAgentLoopBody,
    SerializedAgentLoop,
} from "@kmmao/happy-wire";

interface AgentLoopListResponse {
    loops: SerializedAgentLoop[];
    total: number;
}

interface AgentLoopResponse {
    loop: SerializedAgentLoop | null;
}

export async function fetchAgentLoops(
    credentials: AuthCredentials,
    projectId: string,
    opts?: {
        role?: "generic" | "supervisor";
        limit?: number;
        offset?: number;
    },
): Promise<{ loops: SerializedAgentLoop[]; total: number }> {
    return await apiRequest<AgentLoopListResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops`,
        {
            query: {
                role: opts?.role,
                limit: opts?.limit,
                offset: opts?.offset,
            },
            errorMessage: "Failed to fetch agent loops",
        },
    );
}

export async function fetchAgentLoop(
    credentials: AuthCredentials,
    projectId: string,
    loopId: string,
): Promise<SerializedAgentLoop | null> {
    const data = await apiRequest<AgentLoopResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops/${encodeURIComponent(loopId)}`,
        { errorMessage: "Failed to fetch agent loop" },
    );
    return data.loop;
}

export async function createAgentLoop(
    credentials: AuthCredentials,
    projectId: string,
    body: CreateGenericAgentLoopBody,
): Promise<SerializedAgentLoop> {
    const data = await apiRequest<AgentLoopResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops`,
        {
            method: "POST",
            body,
            errorMessage: "Failed to create agent loop",
        },
    );
    if (!data.loop) {
        throw new Error("Server accepted the create but returned no loop");
    }
    return data.loop;
}

export async function updateAgentLoop(
    credentials: AuthCredentials,
    projectId: string,
    loopId: string,
    body: UpdateGenericAgentLoopBody,
): Promise<SerializedAgentLoop> {
    const data = await apiRequest<AgentLoopResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops/${encodeURIComponent(loopId)}`,
        {
            method: "PATCH",
            body,
            errorMessage: "Failed to update agent loop",
        },
    );
    if (!data.loop) {
        throw new Error("Server accepted the update but returned no loop");
    }
    return data.loop;
}

/**
 * Convenience: PATCH-equivalent that flips just the `enabled` flag.
 * Server has dedicated /enable + /disable routes; mirror them as one
 * method so the call sites stay symmetrical.
 */
export async function setAgentLoopEnabled(
    credentials: AuthCredentials,
    projectId: string,
    loopId: string,
    enabled: boolean,
): Promise<SerializedAgentLoop> {
    const action = enabled ? "enable" : "disable";
    const data = await apiRequest<AgentLoopResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops/${encodeURIComponent(loopId)}/${action}`,
        {
            method: "POST",
            errorMessage: `Failed to ${action} agent loop`,
        },
    );
    if (!data.loop) {
        throw new Error(`Server accepted the ${action} but returned no loop`);
    }
    return data.loop;
}

export async function deleteAgentLoop(
    credentials: AuthCredentials,
    projectId: string,
    loopId: string,
): Promise<void> {
    await apiRequestVoid(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops/${encodeURIComponent(loopId)}`,
        {
            method: "DELETE",
            errorMessage: "Failed to delete agent loop",
        },
    );
}

/**
 * ADR-0022 Phase 4 — unified pause / resume / stop. The server dispatches
 * to the right engine internally (supervisor vs generic) based on the
 * loop's role, so the App passes the same shape regardless of which
 * variant the loop is.
 */
export async function setAgentLoopRuntimeAction(
    credentials: AuthCredentials,
    projectId: string,
    loopId: string,
    action: "pause" | "resume" | "stop",
): Promise<SerializedAgentLoop | null> {
    const data = await apiRequest<AgentLoopResponse>(
        credentials,
        `/v1/projects/${encodeURIComponent(projectId)}/agent-loops/${encodeURIComponent(loopId)}/${action}`,
        {
            method: "POST",
            errorMessage: `Failed to ${action} agent loop`,
        },
    );
    return data.loop;
}

// ────────────────────────────────────────────────────────────────────────
// Local event bus — lets the CreateLoopModal nudge useWorkflows to refetch
// the moment a new loop POST succeeds (instead of waiting for the next
// task-status throttle tick). Singleton; subscribers come and go freely.
// ────────────────────────────────────────────────────────────────────────

type AgentLoopsChangedListener = () => void;
const agentLoopsChangedListeners = new Set<AgentLoopsChangedListener>();

export function onAgentLoopsChanged(listener: AgentLoopsChangedListener): () => void {
    agentLoopsChangedListeners.add(listener);
    return () => {
        agentLoopsChangedListeners.delete(listener);
    };
}

export function notifyAgentLoopsChanged(): void {
    for (const listener of agentLoopsChangedListeners) {
        try {
            listener();
        } catch {
            // A misbehaving subscriber must not prevent the others from running.
        }
    }
}

/**
 * Fan-out helper — list generic loops across many projects in parallel.
 * Used by useWorkflows to fold server-managed loops into the workflow
 * list alongside daemon-state loops. Failures per project are absorbed
 * into the result so a single 404 doesn't poison the whole list.
 */
export async function fetchAgentLoopsAcrossProjects(
    credentials: AuthCredentials,
    projectIds: string[],
    opts?: { role?: "generic" | "supervisor"; limit?: number },
): Promise<SerializedAgentLoop[]> {
    if (projectIds.length === 0) return [];
    const results = await Promise.all(
        projectIds.map((projectId) =>
            fetchAgentLoops(credentials, projectId, opts).catch(() => ({
                loops: [],
                total: 0,
            })),
        ),
    );
    return results.flatMap((r) => r.loops);
}
