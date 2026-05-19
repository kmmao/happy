import { db } from "@/storage/db";
import * as privacyKit from "privacy-kit";

export interface KVBulkGetResult {
    values: Array<{
        key: string;
        value: string;
        version: number;
    }>;
}

/**
 * Get multiple key-value pairs for the authenticated user.
 * Only returns existing keys with non-null values; missing or deleted keys are omitted.
 */
export async function kvBulkGet(
    ctx: { uid: string },
    keys: string[]
): Promise<KVBulkGetResult> {
    if (keys.length > 500) {
        throw new Error(`kvBulkGet: keys array exceeds maximum allowed size of 500 (got ${keys.length})`);
    }

    const results = await db.userKVStore.findMany({
        where: {
            accountId: ctx.uid,
            key: {
                in: keys
            },
            value: {
                not: null  // Exclude deleted entries
            }
        },
        take: Math.min(keys.length, 500)
    });

    return {
        values: results
            .filter(r => r.value !== null)  // Extra safety check
            .map(r => ({
                key: r.key,
                value: privacyKit.encodeBase64(r.value!),
                version: r.version
            }))
    };
}