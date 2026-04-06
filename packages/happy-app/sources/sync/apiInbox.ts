import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";
import * as z from "zod";

export interface ServerInboxItem {
    id: string;
    category: string;
    eventType: string;
    severity: string;
    title: string;
    body?: string;
    read: boolean;
    referenceUrl?: string;
    refType?: string;
    refId?: string;
    groupKey?: string;
    createdAt: number;
}

const InboxItemSchema = z.looseObject({
    id: z.string(),
    category: z.string(),
    eventType: z.string(),
    severity: z.string(),
    title: z.string(),
    read: z.boolean(),
    createdAt: z.number(),
});

const InboxListResponseSchema = z.object({
    items: z.array(InboxItemSchema),
    total: z.number(),
});

const InboxCountResponseSchema = z.object({
    count: z.number(),
});

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchInboxItems(
    credentials: AuthCredentials,
    opts?: {
        category?: string;
        read?: boolean;
        limit?: number;
        offset?: number;
    },
): Promise<{ items: ServerInboxItem[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    if (opts?.read !== undefined) params.set("read", String(opts.read));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/inbox${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch inbox: ${response.status}`);
        }
        const json = await response.json();
        const parsed = InboxListResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid inbox response: ${parsed.error.issues[0]?.message}`);
        }
        return parsed.data;
    });
}

export async function fetchInboxUnreadCount(
    credentials: AuthCredentials,
): Promise<number> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/inbox/count`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch inbox count: ${response.status}`);
        }
        const json = await response.json();
        const parsed = InboxCountResponseSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid inbox count response: ${parsed.error.issues[0]?.message}`);
        }
        return parsed.data.count;
    });
}

export async function markInboxItemRead(
    credentials: AuthCredentials,
    itemId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/inbox/${itemId}/read`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to mark inbox item read: ${response.status}`);
    }
}

export async function markAllInboxRead(
    credentials: AuthCredentials,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/inbox/read-all`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to mark all inbox read: ${response.status}`);
    }
}

export async function deleteInboxItem(
    credentials: AuthCredentials,
    itemId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/inbox/${itemId}`, {
        method: "DELETE",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to delete inbox item: ${response.status}`);
    }
}
