import { db } from "@/storage/db";
import * as privacyKit from "privacy-kit";

export interface KVListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string; // Cursor for pagination: the key of the last item in the previous page
}

export interface KVListResult {
    items: Array<{
        key: string;
        value: string;
        version: number;
    }>;
    nextCursor?: string;
}

/**
 * List key-value pairs for the authenticated user, optionally filtered by prefix.
 * Supports cursor-based pagination via the `cursor` option (key of the last item seen).
 * Returns at most `limit` items (default 100). Fetch one extra to detect the next page.
 */
export async function kvList(
    ctx: { uid: string },
    options?: KVListOptions
): Promise<KVListResult> {
    const pageSize = options?.limit ?? 100;

    const where: any = {
        accountId: ctx.uid,
        value: {
            not: null  // Exclude deleted entries (null values)
        }
    };

    // Add prefix filter if specified
    if (options?.prefix) {
        where.key = {
            startsWith: options.prefix
        };
    }

    const results = await db.userKVStore.findMany({
        where,
        orderBy: {
            key: 'asc'
        },
        take: pageSize + 1, // Fetch one extra to detect if there's a next page
        ...(options?.cursor ? {
            cursor: {
                accountId_key: { accountId: ctx.uid, key: options.cursor }
            },
            skip: 1, // Skip the cursor item itself
        } : {}),
    });

    const hasNextPage = results.length > pageSize;
    const items = hasNextPage ? results.slice(0, pageSize) : results;
    const nextCursor = hasNextPage ? items[items.length - 1]?.key : undefined;

    return {
        items: items
            .filter(r => r.value !== null)  // Extra safety check
            .map(r => ({
                key: r.key,
                value: privacyKit.encodeBase64(r.value!),
                version: r.version
            })),
        ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
}
