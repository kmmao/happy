import { AuthCredentials } from "@/auth/tokenStorage";
import * as z from "zod";
import { apiRequestParsed, apiRequestVoid } from "./apiRequest";

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

export async function fetchInboxItems(
    credentials: AuthCredentials,
    opts?: {
        category?: string;
        read?: boolean;
        limit?: number;
        offset?: number;
    },
): Promise<{ items: ServerInboxItem[]; total: number }> {
    return apiRequestParsed(credentials, "/v1/inbox", InboxListResponseSchema, {
        query: {
            category: opts?.category || undefined,
            read: opts?.read,
            limit: opts?.limit || undefined,
            offset: opts?.offset || undefined,
        },
        errorMessage: "Failed to fetch inbox",
    });
}

export async function fetchInboxUnreadCount(
    credentials: AuthCredentials,
): Promise<number> {
    const { count } = await apiRequestParsed(credentials, "/v1/inbox/count", InboxCountResponseSchema, {
        errorMessage: "Failed to fetch inbox count",
    });
    return count;
}

export async function markInboxItemRead(
    credentials: AuthCredentials,
    itemId: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/inbox/${itemId}/read`, {
        method: "POST",
        retry: false,
        errorMessage: "Failed to mark inbox item read",
    });
}

export async function markAllInboxRead(
    credentials: AuthCredentials,
): Promise<void> {
    await apiRequestVoid(credentials, "/v1/inbox/read-all", {
        method: "POST",
        retry: false,
        errorMessage: "Failed to mark all inbox read",
    });
}

export async function deleteInboxItem(
    credentials: AuthCredentials,
    itemId: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/inbox/${itemId}`, {
        method: "DELETE",
        retry: false,
        errorMessage: "Failed to delete inbox item",
    });
}

export async function clearAllInbox(
    credentials: AuthCredentials,
): Promise<void> {
    await apiRequestVoid(credentials, "/v1/inbox", {
        method: "DELETE",
        retry: false,
        errorMessage: "Failed to clear inbox",
    });
}
