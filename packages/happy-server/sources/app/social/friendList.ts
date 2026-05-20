import { Context } from "@/context";
import { buildUserProfile, UserProfile } from "./type";
import { db } from "@/storage/db";
import { RelationshipStatus } from "@prisma/client";

export interface FriendListOptions {
    limit?: number;
    cursor?: string; // Cursor for pagination: toUserId of the last item in the previous page
}

export interface FriendListResult {
    items: UserProfile[];
    nextCursor?: string;
}

/**
 * List all relationships (friend, pending, requested) for the authenticated user.
 * Supports cursor-based pagination via `cursor` (toUserId of the last item seen).
 * Returns at most `limit` items (default 100).
 */
export async function friendList(ctx: Context, options?: FriendListOptions): Promise<FriendListResult> {
    const pageSize = options?.limit ?? 100;

    // Query relationships with cursor-based pagination
    const relationships = await db.userRelationship.findMany({
        where: {
            fromUserId: ctx.uid,
            status: {
                in: [RelationshipStatus.friend, RelationshipStatus.pending, RelationshipStatus.requested]
            }
        },
        include: {
            toUser: {
                include: {
                    githubUser: true
                }
            }
        },
        orderBy: {
            toUserId: 'asc'
        },
        take: pageSize + 1, // Fetch one extra to detect if there's a next page
        ...(options?.cursor ? {
            cursor: {
                fromUserId_toUserId: { fromUserId: ctx.uid, toUserId: options.cursor }
            },
            skip: 1, // Skip the cursor item itself
        } : {}),
    });

    const hasNextPage = relationships.length > pageSize;
    const page = hasNextPage ? relationships.slice(0, pageSize) : relationships;
    const nextCursor = hasNextPage ? page[page.length - 1]?.toUserId : undefined;

    // Build UserProfile objects
    const items: UserProfile[] = [];
    for (const relationship of page) {
        items.push(buildUserProfile(relationship.toUser, relationship.status));
    }

    return {
        items,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
}
