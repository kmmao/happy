import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";
import * as z from "zod";

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

// Zod schema for validating project list responses from the server
const ProjectListResponseSchema = z.object({
    projects: z.array(z.looseObject({
        id: z.string(),
        machineId: z.string(),
        path: z.string(),
    })),
});

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

        const json = await response.json();
        const parsed = ProjectListResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid projects response: ${parsed.error.issues[0]?.message}`);
        }
        return parsed.data.projects as unknown as ServerProject[];
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

export interface RoleActiveTask {
    id: string;
    status: string;
    sessionId: string | null;
}

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
    agentType: string | null;
    modelOverride: string | null;
    activeTasks: RoleActiveTask[];
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
        agentType?: string | null;
        modelOverride?: string | null;
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
        agentType?: string | null;
        modelOverride?: string | null;
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

export interface GoalBlockerSummary {
    kind: "planner_timeout" | "task_failed" | "agent_conflict" | "agent_request";
    summary: string;
    sourceTaskId?: string;
    sourceMessageId?: string;
    requiresHuman: boolean;
    sessionId?: string;
    decisionId?: string;
    messageStatus?: "unread" | "read" | "resolved";
}

export interface GoalTaskStatusSummary {
    dispatching: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}

export interface GoalLatestSessionSummary {
    sessionId: string;
    taskId: string;
    taskTitle: string | null;
    status: string;
    updatedAt: number;
}

export interface GoalTaskSummary {
    id: string;
    title: string | null;
    status: string;
    sessionId: string | null;
    roleType: string | null;
}

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
    healthScore: number | null;
    layer: string | null;
    createdAt: number;
    updatedAt: number;
    subGoalCount: number;
    taskCount: number;
    decisionCount: number;
    taskStatusSummary?: GoalTaskStatusSummary;
    latestSession?: GoalLatestSessionSummary | null;
    blocker?: GoalBlockerSummary | null;
    tasks: GoalTaskSummary[];
}

export interface GoalDetailTask {
    id: string;
    title: string | null;
    status: string;
    sessionId: string | null;
    roleType: string | null;
    promptPreview: string;
    priority: string;
    createdAt: number;
    completedAt: number | null;
}

export interface GoalDetailDecision {
    id: string;
    question: string;
    status: string;
    createdAt: number;
}

export interface GoalDetailSubGoal {
    id: string;
    title: string;
    status: string;
    progress: number;
    priority: string;
}

export interface GoalDetail extends GoalSummary {
    tasks: GoalDetailTask[];
    subGoals: GoalDetailSubGoal[];
    blockers: GoalBlockerSummary[];
    decisions: GoalDetailDecision[];
}

const GoalBlockerSummarySchema = z.object({
    kind: z.enum(["planner_timeout", "task_failed", "agent_conflict", "agent_request"]),
    summary: z.string(),
    sourceTaskId: z.string().optional(),
    sourceMessageId: z.string().optional(),
    requiresHuman: z.boolean(),
    sessionId: z.string().optional(),
    decisionId: z.string().optional(),
    messageStatus: z.enum(["unread", "read", "resolved"]).optional(),
});


const GoalTaskStatusSummarySchema = z.object({
    dispatching: z.number().int().min(0),
    queued: z.number().int().min(0),
    running: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    cancelled: z.number().int().min(0),
});

const GoalLatestSessionSummarySchema = z.object({
    sessionId: z.string(),
    taskId: z.string(),
    taskTitle: z.string().nullable(),
    status: z.string(),
    updatedAt: z.number().int().nonnegative(),
});

const GoalTaskSummarySchema = z.object({
    id: z.string(),
    title: z.string().nullable(),
    status: z.string(),
    sessionId: z.string().nullable(),
    roleType: z.string().nullable(),
});

const GoalSummarySchema = z.object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(["planning", "in_progress", "blocked", "completed", "cancelled"]),
    progress: z.number().int().min(0).max(100),
    priority: z.enum(["urgent", "normal", "low"]),
    deadline: z.number().int().nullable(),
    parentGoalId: z.string().nullable(),
    machineId: z.string(),
    createdBy: z.string(),
    plannerTaskId: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    subGoalCount: z.number().int().min(0),
    taskCount: z.number().int().min(0),
    decisionCount: z.number().int().min(0),
    taskStatusSummary: GoalTaskStatusSummarySchema.optional(),
    latestSession: GoalLatestSessionSummarySchema.nullable().optional(),
    blocker: GoalBlockerSummarySchema.nullable().optional(),
    tasks: z.array(GoalTaskSummarySchema),
});

const GoalDetailTaskSchema = z.object({
    id: z.string(),
    title: z.string().nullable(),
    status: z.string(),
    sessionId: z.string().nullable(),
    roleType: z.string().nullable(),
    promptPreview: z.string(),
    priority: z.string(),
    createdAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nullable(),
});

const GoalDetailDecisionSchema = z.object({
    id: z.string(),
    question: z.string(),
    status: z.string(),
    createdAt: z.number().int().nonnegative(),
});

const GoalDetailSubGoalSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    progress: z.number().int().min(0).max(100),
    priority: z.string(),
});

const GoalDetailSchema = GoalSummarySchema.extend({
    tasks: z.array(GoalDetailTaskSchema),
    subGoals: z.array(GoalDetailSubGoalSchema),
    blockers: z.array(GoalBlockerSummarySchema),
    decisions: z.array(GoalDetailDecisionSchema),
});

const GoalsResponseSchema = z.object({
    goals: z.array(GoalSummarySchema),
    total: z.number().int().min(0),
});

const GoalDetailResponseSchema = z.object({
    goal: GoalDetailSchema,
});

export async function fetchGoalDetail(
    credentials: AuthCredentials,
    projectId: string,
    goalId: string,
): Promise<GoalDetail> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals/${goalId}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch goal detail: ${response.status}`);
        }
        const json = await response.json();
        const parsed = GoalDetailResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid goal detail response: ${parsed.error.issues[0]?.message}`);
        }
        return parsed.data.goal as GoalDetail;
    });
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
        const json = await response.json();
        const parsed = GoalsResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid goals response: ${parsed.error.issues[0]?.message}`);
        }
        return parsed.data.goals as GoalSummary[];
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

export async function replanGoal(
    credentials: AuthCredentials,
    projectId: string,
    goalId: string,
): Promise<{ replanned: boolean; plannerTaskId: string | null }> {
    const API_ENDPOINT = getServerUrl();
    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectId}/goals/${goalId}/replan`,
            {
                method: "POST",
                headers: authHeaders(credentials),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to replan goal: ${response.status}`);
        }
        return (await response.json()) as { replanned: boolean; plannerTaskId: string | null };
    });
}
