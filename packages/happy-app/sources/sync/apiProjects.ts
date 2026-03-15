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

        if (!response.ok) {
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
