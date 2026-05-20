import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
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
    const API_ENDPOINT = getServerUrl();
    const all: ServerProject[] = [];
    let cursor: string | undefined;

    do {
        const qs = new URLSearchParams({ limit: '100' });
        if (archived !== undefined) qs.set('archived', String(archived));
        if (cursor) qs.set('cursor', cursor);

        const page = await backoff(async () => {
            const response = await fetch(
                `${API_ENDPOINT}/v1/projects?${qs}`,
                { headers: authHeaders(credentials) },
            );

            throwIfNotOk(response, 'Failed to fetch projects');

            const json = await response.json();
            const parsed = ProjectListResponseSchema.safeParse(json);
            if (!parsed.success) {
                throw new Error(`Invalid projects response: ${parsed.error.issues[0]?.message}`);
            }
            return parsed.data;
        });

        all.push(...(page.projects as unknown as ServerProject[]));
        cursor = page.nextCursor ?? undefined;
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
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/projects`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(params),
        });

        throwIfNotOk(response, 'Failed to create project');

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

        throwIfNotOk(response, 'Failed to resolve project');

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

        throwIfNotOk(response, 'Failed to update project');

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

        throwIfNotOk(response, 'Failed to link sessions');

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

        throwIfNotOk(response, 'Failed to fetch related projects');

        const data = (await response.json()) as RelatedProjectsResponse;
        return data.related;
    });
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

