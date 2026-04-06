import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

/**
 * Server-side project representation
 */
export interface ServerProject {
    id: string;
    machineId: string;
    path: string;
    repoUrl: string | null;
    metadata: string | null;
    metadataVersion: number;
    supervisorConfig: string | null;
    supervisorConfigVersion: number;
    supervisorMode: string | null;
    supervisorScheduleEnabled: boolean;
    supervisorScheduleIntervalHours: number | null;
    supervisorEnabledDimensions: string | null;
    supervisorPushTriggerEnabled: boolean;
    supervisorCustomRules: string | null;
    narrative: string | null;
    laws: string | null;
    archived: boolean;
    sessionCount?: number;
    createdAt: number;
    updatedAt: number;
}

interface ProjectListResponse {
    projects: ServerProject[];
}

interface ProjectResponse {
    project: ServerProject;
    created: boolean;
}

interface ProjectSingleResponse {
    project: ServerProject;
}

interface LinkSessionsResponse {
    linked: number;
}

/**
 * Related project on a different machine (same repoUrl)
 */
export interface RelatedProject {
    id: string;
    machineId: string;
    machineName: string;
    path: string;
    repoUrl: string | null;
    supervisorMode: string | null;
    updatedAt: number;
}

interface RelatedProjectsResponse {
    related: RelatedProject[];
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

/**
 * Fetch all projects for the authenticated user
 */
export async function fetchProjects(
    credentials: AuthCredentials,
    archived?: boolean,
): Promise<ServerProject[]> {
    const API_ENDPOINT = getServerUrl();
    const params = archived !== undefined ? `?archived=${archived}` : "";

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects${params}`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch projects: ${response.status}`);
        }

        const data = (await response.json()) as ProjectListResponse;
        return data.projects;
    });
}

/**
 * Create a new project
 */
export async function createProject(
    credentials: AuthCredentials,
    params: {
        machineId: string;
        path: string;
        repoUrl?: string | null;
        metadata?: string | null;
    },
): Promise<{ project: ServerProject; created: boolean }> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/projects`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            throw new Error(`Failed to create project: ${response.status}`);
        }

        return (await response.json()) as ProjectResponse;
    });
}

/**
 * Resolve a project by machineId + path (find or create, idempotent)
 */
export async function resolveProject(
    credentials: AuthCredentials,
    params: {
        machineId: string;
        path: string;
        repoUrl?: string | null;
        metadata?: string | null;
    },
): Promise<{ project: ServerProject; created: boolean }> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/resolve`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify(params),
            },
        );

        if (!response.ok) {
            throw new Error(`Failed to resolve project: ${response.status}`);
        }

        return (await response.json()) as ProjectResponse;
    });
}

/**
 * Update a project
 */
export async function updateProject(
    credentials: AuthCredentials,
    projectId: string,
    params: {
        metadata?: string | null;
        repoUrl?: string | null;
        archived?: boolean;
        narrative?: string | null;
        laws?: string | null;
    },
): Promise<ServerProject> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}`,
            {
                method: "PATCH",
                headers: authHeaders(credentials),
                body: JSON.stringify(params),
            },
        );

        if (!response.ok) {
            throw new Error(`Failed to update project: ${response.status}`);
        }

        const data = (await response.json()) as ProjectSingleResponse;
        return data.project;
    });
}

/**
 * Delete a project
 */
export async function deleteProject(
    credentials: AuthCredentials,
    projectId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}`,
            {
                method: "DELETE",
                headers: authHeaders(credentials),
            },
        );

        // 404 = already deleted, treat as success
        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete project: ${response.status}`);
        }
    });
}

/**
 * Batch link sessions to a project
 */
export async function linkSessionsToProject(
    credentials: AuthCredentials,
    projectId: string,
    sessionIds: string[],
): Promise<number> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/link-sessions`,
            {
                method: "POST",
                headers: authHeaders(credentials),
                body: JSON.stringify({ sessionIds }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to link sessions: ${response.status}`,
            );
        }

        const data = (await response.json()) as LinkSessionsResponse;
        return data.linked;
    });
}

/**
 * Fetch related projects (same repoUrl, different machines)
 */
export async function fetchRelatedProjects(
    credentials: AuthCredentials,
    projectId: string,
): Promise<RelatedProject[]> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/related`,
            { headers: authHeaders(credentials) },
        );

        if (!response.ok) {
            throw new Error(
                `Failed to fetch related projects: ${response.status}`,
            );
        }

        const data = (await response.json()) as RelatedProjectsResponse;
        return data.related;
    });
}

// === Agent Roles ===

export interface AgentRoleSummary {
    id: string;
    projectId: string;
    name: string;
    type: string;
    description: string | null;
    duties: string[];
    skillIds: string[];
    maxConcurrency: number;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}

interface AgentRolesResponse {
    roles: AgentRoleSummary[];
    total: number;
}

export async function fetchAgentRoles(
    credentials: AuthCredentials,
    projectId: string,
): Promise<AgentRoleSummary[]> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/agent-roles?projectId=${projectId}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch agent roles: ${response.status}`);
        }
        const data = (await response.json()) as AgentRolesResponse;
        return data.roles;
    });
}

export async function createAgentRole(
    credentials: AuthCredentials,
    body: {
        projectId: string;
        name: string;
        type?: string;
        description?: string;
        duties?: string[];
        skillIds?: string[];
        templateType?: string;
    },
): Promise<AgentRoleSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/agent-roles`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to create agent role: ${response.status}`);
        }
        const data = (await response.json()) as { role: AgentRoleSummary };
        return data.role;
    });
}

export async function updateAgentRole(
    credentials: AuthCredentials,
    roleId: string,
    body: {
        name?: string;
        type?: string;
        description?: string | null;
        duties?: string[];
        skillIds?: string[];
        maxConcurrency?: number;
        enabled?: boolean;
    },
): Promise<AgentRoleSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/agent-roles/${roleId}`, {
            method: "PATCH",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to update agent role: ${response.status}`);
        }
        const data = (await response.json()) as { role: AgentRoleSummary };
        return data.role;
    });
}

export async function deleteAgentRole(
    credentials: AuthCredentials,
    roleId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/agent-roles/${roleId}`, {
            method: "DELETE",
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            throw new Error(`Failed to delete agent role: ${response.status}`);
        }
    });
}

// === Goal API ===

export interface GoalSummary {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    status: string;
    progress: number;
    priority: string;
    deadline: number | null;
    parentGoalId: string | null;
    machineId: string;
    createdBy: string;
    plannerTaskId: string | null;
    createdAt: number;
    updatedAt: number;
    subGoalCount: number;
    taskCount: number;
    decisionCount: number;
}

interface GoalsResponse {
    goals: GoalSummary[];
    total: number;
}

export async function fetchGoals(
    credentials: AuthCredentials,
    projectId: string,
    opts?: { status?: string; parentGoalId?: string },
): Promise<GoalSummary[]> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const params = new URLSearchParams();
        if (opts?.status) params.set("status", opts.status);
        if (opts?.parentGoalId !== undefined) params.set("parentGoalId", opts.parentGoalId);
        const qs = params.toString();
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch goals: ${response.status}`);
        }
        const data = (await response.json()) as GoalsResponse;
        return data.goals;
    });
}

export async function createGoal(
    credentials: AuthCredentials,
    projectId: string,
    body: {
        title: string;
        description?: string;
        priority?: string;
        deadline?: string;
        parentGoalId?: string;
        machineId: string;
        autoDecompose?: boolean;
    },
): Promise<GoalSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/projects/${projectId}/goals`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Failed to create goal: ${response.status}`);
        }
        const data = (await response.json()) as { goal: GoalSummary };
        return data.goal;
    });
}

export async function cancelGoal(
    credentials: AuthCredentials,
    projectId: string,
    goalId: string,
): Promise<GoalSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals/${goalId}/cancel`,
            {
                method: "POST",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to cancel goal: ${response.status}`);
        }
        const data = (await response.json()) as { goal: GoalSummary };
        return data.goal;
    });
}

export async function decomposeGoal(
    credentials: AuthCredentials,
    projectId: string,
    goalId: string,
): Promise<GoalSummary> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals/${goalId}/decompose`,
            {
                method: "POST",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to decompose goal: ${response.status}`);
        }
        const data = (await response.json()) as { goal: GoalSummary };
        return data.goal;
    });
}

export async function deleteGoal(
    credentials: AuthCredentials,
    projectId: string,
    goalId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals/${goalId}`,
            {
                method: "DELETE",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to delete goal: ${response.status}`);
        }
    });
}
