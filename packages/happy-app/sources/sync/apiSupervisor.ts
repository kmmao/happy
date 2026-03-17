import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { NonRetryableError } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

/**
 * Serialized supervisor run from server
 */
export interface SupervisorRun {
    id: string;
    projectId: string;
    trigger: string; // "manual" | "scheduled" | "event" | "research"
    status: string; // "pending" | "running" | "completed" | "failed" | "cancelled"
    artifactId: string | null;
    reportTitle: string | null;
    reportContent: string | null;
    researchParams: string | null;
    actionsCount: number;
    issuesCreated: number;
    sessionId: string | null;
    errorMessage: string | null;
    tokenCount: number | null;
    costUsd: number | null;
    healthScore: number | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
}

interface RunResponse {
    run: SupervisorRun;
}

interface RunsListResponse {
    runs: SupervisorRun[];
    total: number;
}

interface SupervisorConfigResponse {
    supervisorConfig: string | null;
    supervisorConfigVersion: number;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

/**
 * Trigger a manual supervisor run for a project
 */
export async function triggerSupervisorRun(
    credentials: AuthCredentials,
    projectId: string,
    params?: {
        machineId?: string;
        repoPath?: string;
        trigger?: "manual" | "research";
        researchParams?: {
            knownCompetitors?: string;
            focusAreas?: string;
            additionalNotes?: string;
        };
    },
): Promise<SupervisorRun> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/run`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify(params ?? {}),
            },
        );

        if (response.status === 409) {
            const data = (await response.json()) as {
                error: string;
                runId: string;
            };
            throw new SupervisorAlreadyRunningError(data.error, data.runId);
        }

        if (response.status === 429) {
            const data = (await response.json()) as { error: string };
            throw new NonRetryableError(data.error);
        }

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new NonRetryableError(
                text || `Failed to trigger supervisor run: ${response.status}`,
            );
        }

        const data = (await response.json()) as RunResponse;
        return data.run;
    });
}

/**
 * Fetch supervisor run history for a project
 */
export async function fetchSupervisorRuns(
    credentials: AuthCredentials,
    projectId: string,
    params?: { limit?: number; offset?: number; trigger?: string },
): Promise<{ runs: SupervisorRun[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined)
        query.set("offset", String(params.offset));
    if (params?.trigger) query.set("trigger", params.trigger);
    const qs = query.toString() ? `?${query.toString()}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/runs${qs}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor runs: ${response.status}`,
            );
        }

        return (await response.json()) as RunsListResponse;
    });
}

/**
 * Get a single supervisor run's details
 */
export async function fetchSupervisorRun(
    credentials: AuthCredentials,
    projectId: string,
    runId: string,
): Promise<SupervisorRun> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/runs/${runId}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor run: ${response.status}`,
            );
        }

        const data = (await response.json()) as RunResponse;
        return data.run;
    });
}

/**
 * Cancel a running supervisor run
 */
export async function cancelSupervisorRun(
    credentials: AuthCredentials,
    projectId: string,
    runId: string,
): Promise<SupervisorRun> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/cancel/${runId}`,
            {
                method: "POST",
                headers: authHeaders(credentials),
            },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to cancel supervisor run: ${response.status}`,
            );
        }

        const data = (await response.json()) as RunResponse;
        return data.run;
    });
}

/**
 * Update supervisor configuration for a project (encrypted + plaintext scheduling fields)
 */
export async function updateSupervisorConfig(
    credentials: AuthCredentials,
    projectId: string,
    supervisorConfig: string | null,
    scheduling?: {
        supervisorMode?: string;
        supervisorScheduleEnabled?: boolean;
        supervisorScheduleIntervalHours?: number;
        supervisorEnabledDimensions?: string;
        supervisorPushTriggerEnabled?: boolean;
        supervisorNotifyPrefs?: string | null;
        supervisorCustomRules?: string | null;
        fixStrategy?: "direct" | "pr" | null;
    },
): Promise<SupervisorConfigResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/config`,
            {
                method: "PATCH",
                headers: authHeaders(credentials),
                body: JSON.stringify({
                    supervisorConfig,
                    ...scheduling,
                }),
            },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to update supervisor config: ${response.status}`,
            );
        }

        return (await response.json()) as SupervisorConfigResponse;
    });
}

/**
 * Error thrown when a supervisor run is already in progress
 */
export class SupervisorAlreadyRunningError extends NonRetryableError {
    public readonly runId: string;

    constructor(message: string, runId: string) {
        super(message);
        this.name = "SupervisorAlreadyRunningError";
        Object.setPrototypeOf(this, SupervisorAlreadyRunningError.prototype);
        this.runId = runId;
    }
}

// --- Cost Tracking ---

export interface SupervisorCostSummary {
    days: number;
    runsCount: number;
    totalTokens: number;
    totalCostUsd: number;
}

// --- Trend Data ---

export interface TrendPoint {
    date: number;
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    score: number | null;
}

export interface SupervisorTrendData {
    days: number;
    points: TrendPoint[];
}

/**
 * Fetch aggregated supervisor cost for a project
 */
export async function fetchSupervisorCost(
    credentials: AuthCredentials,
    projectId: string,
    days?: number,
): Promise<SupervisorCostSummary> {
    const API_ENDPOINT = getServerUrl();
    const params = days !== undefined ? `?days=${days}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/cost${params}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor cost: ${response.status}`,
            );
        }

        return (await response.json()) as SupervisorCostSummary;
    });
}

/**
 * Fetch trend data (severity distribution over time) for a project
 */
export async function fetchSupervisorTrend(
    credentials: AuthCredentials,
    projectId: string,
    days?: number,
): Promise<SupervisorTrendData> {
    const API_ENDPOINT = getServerUrl();
    const params = days !== undefined ? `?days=${days}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/trend${params}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor trend: ${response.status}`,
            );
        }

        return (await response.json()) as SupervisorTrendData;
    });
}

// --- Supervisor Actions ---

export interface SupervisorAction {
    id: string;
    runId: string;
    projectId: string;
    severity: string; // "critical" | "high" | "medium" | "low"
    category: string; // "security" | "dependencies" | "architecture" | etc.
    title: string;
    description: string;
    suggestedFix: string | null;
    confidence: number | null;
    approval: string; // "pending" | "approved" | "skipped" | "ignored"
    fixSessionId: string | null;
    fixStatus: string | null; // "pending" | "running" | "completed" | "failed"
    issueUrl: string | null;
    lastSeenRunId: string | null;
    createdAt: number;
    updatedAt: number;
}

interface ActionsListResponse {
    actions: SupervisorAction[];
    total: number;
}

/**
 * Fetch supervisor actions for a project
 */
export async function fetchSupervisorActions(
    credentials: AuthCredentials,
    projectId: string,
    params?: {
        approval?: string;
        view?: string;
        runId?: string;
        limit?: number;
        offset?: number;
    },
): Promise<{ actions: SupervisorAction[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const query = new URLSearchParams();
    if (params?.approval) query.set("approval", params.approval);
    if (params?.view) query.set("view", params.view);
    if (params?.runId) query.set("runId", params.runId);
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined)
        query.set("offset", String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions${qs}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor actions: ${response.status}`,
            );
        }

        return (await response.json()) as ActionsListResponse;
    });
}

/**
 * Update action approval status
 */
export async function updateActionApproval(
    credentials: AuthCredentials,
    projectId: string,
    actionId: string,
    approval: "approved" | "skipped" | "ignored",
): Promise<SupervisorAction | null> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions/${actionId}`,
            {
                method: "PATCH",
                headers: authHeaders(credentials),
                body: JSON.stringify({ approval }),
            },
        );

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new NonRetryableError(
                text || `Failed to update action approval: ${response.status}`,
            );
        }

        const data = (await response.json()) as { action: SupervisorAction };
        return data.action;
    });
}

/**
 * Trigger a fix session for an approved action
 */
export async function triggerActionFix(
    credentials: AuthCredentials,
    projectId: string,
    actionId: string,
    params?: { machineId?: string; repoPath?: string },
): Promise<SupervisorAction | null> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions/${actionId}/fix`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify(params ?? {}),
            },
        );

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new NonRetryableError(
                text || `Failed to trigger action fix: ${response.status}`,
            );
        }

        const data = (await response.json()) as { action: SupervisorAction };
        return data.action;
    });
}

// --- Summary ---

export interface SupervisorSummary {
    grade: "A" | "B" | "C" | "D" | "F";
    score: number;
    openCounts: { critical: number; high: number; medium: number; low: number };
    trendDirection: "improving" | "stable" | "declining";
    lastScanAt: number | null;
    totalRuns30d: number;
    nextRunAt: number | null;
}

/**
 * Fetch aggregated health summary for a project
 */
export async function fetchSupervisorSummary(
    credentials: AuthCredentials,
    projectId: string,
): Promise<SupervisorSummary> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/summary`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch supervisor summary: ${response.status}`,
            );
        }

        return (await response.json()) as SupervisorSummary;
    });
}

// --- Batch Operations ---

export interface SupervisorActionStats {
    pending: number;
    approved: number;
    skipped: number;
    ignored: number;
    approvedNoFix: number;
    fixPending: number;
    fixRunning: number;
    fixCompleted: number;
    fixFailed: number;
}

export interface RunExport {
    content: string;
    filename: string;
}

/**
 * Batch update action approval status
 */
export async function batchUpdateActionApproval(
    credentials: AuthCredentials,
    projectId: string,
    actionIds: string[],
    approval: "approved" | "skipped" | "ignored",
): Promise<{ updatedCount: number }> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions/batch`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify({ actionIds, approval }),
            },
        );
        if (!response.ok) {
            throw new NonRetryableError(`Failed to batch update actions: ${response.status}`);
        }
        return (await response.json()) as { updatedCount: number };
    });
}

/**
 * Clear all actions for a project
 */
export async function clearAllActions(
    credentials: AuthCredentials,
    projectId: string,
): Promise<{ deletedCount: number }> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions`,
            {
                method: "DELETE",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new NonRetryableError(`Failed to clear actions: ${response.status}`);
        }
        return (await response.json()) as { deletedCount: number };
    });
}

/**
 * Delete a single action
 */
export async function deleteAction(
    credentials: AuthCredentials,
    projectId: string,
    actionId: string,
): Promise<{ deleted: boolean }> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions/${actionId}`,
            {
                method: "DELETE",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new NonRetryableError(`Failed to delete action: ${response.status}`);
        }
        return (await response.json()) as { deleted: boolean };
    });
}

/**
 * Fetch action stats (counts by approval status)
 */
export async function fetchActionStats(
    credentials: AuthCredentials,
    projectId: string,
): Promise<SupervisorActionStats> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/actions/stats`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new NonRetryableError(`Failed to fetch action stats: ${response.status}`);
        }
        return (await response.json()) as SupervisorActionStats;
    });
}

/**
 * Export a run report as Markdown
 */
export async function exportRunReport(
    credentials: AuthCredentials,
    projectId: string,
    runId: string,
    format: "markdown" = "markdown",
): Promise<RunExport> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/runs/${runId}/export?format=${format}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new NonRetryableError(`Failed to export run report: ${response.status}`);
        }
        return (await response.json()) as RunExport;
    });
}

// --- Run Comparison ---

export interface RunComparisonAction {
    id: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    suggestedFix: string | null;
    confidence: number | null;
    approval: string;
    fixStatus: string | null;
}

export interface RunComparison {
    currentRun: {
        id: string;
        createdAt: number;
        completedAt: number | null;
        trigger: string;
        actionsCount: number;
        tokenCount: number | null;
        costUsd: number | null;
        healthScore: number | null;
    };
    previousRun: {
        id: string;
        createdAt: number;
        completedAt: number | null;
        actionsCount: number;
    } | null;
    newActions: RunComparisonAction[];
    resolvedActions: RunComparisonAction[];
    persistentActions: RunComparisonAction[];
}

/**
 * Fetch run comparison (diff with previous run)
 */
export async function fetchRunComparison(
    credentials: AuthCredentials,
    projectId: string,
    runId: string,
): Promise<RunComparison> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/supervisor/runs/${runId}/compare`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new NonRetryableError(
                `Failed to fetch run comparison: ${response.status}`,
            );
        }

        return (await response.json()) as RunComparison;
    });
}
