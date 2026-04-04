import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

export interface ServerSkill {
    id: string;
    projectId: string | null;
    name: string;
    description: string | null;
    content: string;
    contentVersion: number;
    attachments: string[];
    sourceKnowledgeId: string | null;
    archived: boolean;
    createdAt: number;
    updatedAt: number;
}

interface SkillListResponse {
    skills: ServerSkill[];
    total: number;
}

interface SkillResponse {
    skill: ServerSkill;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchSkills(
    credentials: AuthCredentials,
    opts?: {
        projectId?: string;
        archived?: boolean;
        limit?: number;
        offset?: number;
    },
): Promise<{ skills: ServerSkill[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.archived !== undefined) params.set("archived", String(opts.archived));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/skills${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch skills: ${response.status}`);
        }
        return (await response.json()) as SkillListResponse;
    });
}

export async function fetchSkill(
    credentials: AuthCredentials,
    skillId: string,
): Promise<ServerSkill> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/skills/${skillId}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch skill: ${response.status}`);
        }
        const data = (await response.json()) as SkillResponse;
        return data.skill;
    });
}

export async function createSkill(
    credentials: AuthCredentials,
    body: {
        name: string;
        description?: string;
        content: string;
        projectId?: string;
        sourceKnowledgeId?: string;
    },
): Promise<ServerSkill> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/skills`, {
        method: "POST",
        headers: authHeaders(credentials),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = (data as Record<string, string>).error;
        if (error === "skill-name-conflict") {
            throw new Error("skill-name-conflict");
        }
        throw new Error(error ?? `Failed to create skill: ${response.status}`);
    }
    const data = (await response.json()) as SkillResponse;
    return data.skill;
}

export async function updateSkill(
    credentials: AuthCredentials,
    skillId: string,
    body: {
        name?: string;
        description?: string | null;
        content?: string;
    },
): Promise<ServerSkill> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/skills/${skillId}`, {
        method: "PATCH",
        headers: authHeaders(credentials),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = (data as Record<string, string>).error;
        if (error === "skill-name-conflict") {
            throw new Error("skill-name-conflict");
        }
        throw new Error(error ?? `Failed to update skill: ${response.status}`);
    }
    const data = (await response.json()) as SkillResponse;
    return data.skill;
}

export async function archiveSkill(
    credentials: AuthCredentials,
    skillId: string,
): Promise<ServerSkill> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/skills/${skillId}/archive`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to archive skill: ${response.status}`);
    }
    const data = (await response.json()) as SkillResponse;
    return data.skill;
}

export async function deleteSkill(
    credentials: AuthCredentials,
    skillId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/skills/${skillId}`, {
        method: "DELETE",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to delete skill: ${response.status}`);
    }
}
