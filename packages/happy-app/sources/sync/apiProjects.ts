import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import { getServerUrl } from "./serverConfig";
import { apiRequest } from "./apiRequest";
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
    /** ADR-0022 D-1 — health threshold above which standalone runs auto-start a supervisor loop; null disables. */
    autoLoopHealthThreshold: number | null;
    /** ADR-0022 D-1 — debounce window (minutes) between auto-loop starts. 0 disables debounce. Default 1440 (24h). */
    autoLoopDebounceMinutes: number;
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
    nextCursor: z.string().nullable().optional(),
});

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
 * Fetch all projects for the authenticated user (paginates through all pages)
 */
export async function fetchProjects(
    credentials: AuthCredentials,
    archived?: boolean,
): Promise<ServerProject[]> {
    const all: ServerProject[] = [];
    let cursor: string | undefined;

    do {
        const json = await apiRequest<unknown>(credentials, "/v1/projects", {
            query: {
                limit: 100,
                archived: archived !== undefined ? archived : undefined,
                cursor: cursor || undefined,
            },
            errorMessage: "Failed to fetch projects",
        });
        const parsed = ProjectListResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid projects response: ${parsed.error.issues[0]?.message}`);
        }

        all.push(...(parsed.data.projects as unknown as ServerProject[]));
        cursor = parsed.data.nextCursor ?? undefined;
    } while (cursor);

    return all;
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
    return await apiRequest<ProjectResponse>(credentials, "/v1/projects", {
        method: "POST",
        body: params,
        errorMessage: "Failed to create project",
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
    return await apiRequest<ProjectResponse>(credentials, "/v1/projects/resolve", {
        method: "POST",
        body: params,
        errorMessage: "Failed to resolve project",
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
    },
): Promise<ServerProject> {
    const data = await apiRequest<ProjectSingleResponse>(credentials, `/v1/projects/${projectId}`, {
        method: "PATCH",
        body: params,
        errorMessage: "Failed to update project",
    });
    return data.project;
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
        if (response.status !== 404) {
            throwIfNotOk(response, 'Failed to delete project');
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
    const data = await apiRequest<LinkSessionsResponse>(credentials, `/v1/projects/${projectId}/link-sessions`, {
        method: "POST",
        body: { sessionIds },
        errorMessage: "Failed to link sessions",
    });
    return data.linked;
}

/**
 * Fetch related projects (same repoUrl, different machines)
 */
export async function fetchRelatedProjects(
    credentials: AuthCredentials,
    projectId: string,
): Promise<RelatedProject[]> {
    const data = await apiRequest<RelatedProjectsResponse>(credentials, `/v1/projects/${projectId}/related`, {
        errorMessage: "Failed to fetch related projects",
    });
    return data.related;
}

/**
 * Record that a session was forked from a parent session.
 * Called immediately after fork+spawn succeeds so the relationship is persisted.
 */
export async function setSessionForkSource(
    sessionId: string,
    forkedFromSessionId: string,
    credentials: AuthCredentials,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/fork-source`, {
        method: "PATCH",
        headers: authHeaders(credentials),
        body: JSON.stringify({ forkedFromSessionId }),
    });
}
