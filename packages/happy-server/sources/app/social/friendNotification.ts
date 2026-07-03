import { Prisma, RelationshipStatus } from "@prisma/client";
import { feedPost } from "@/app/feed/feedPost";
import { Context } from "@/context";

/**
 * Check if a notification should be sent based on the last notification time and relationship status.
 * Returns true if:
 * - No previous notification was sent (lastNotifiedAt is null)
 * - OR 24 hours have passed since the last notification
 * - AND the relationship is not rejected
 */
export function shouldSendNotification(
    lastNotifiedAt: Date | null,
    status: RelationshipStatus
): boolean {
    // Don't send notifications for rejected relationships
    if (status === RelationshipStatus.rejected) {
        return false;
    }

    // If never notified, send notification
    if (!lastNotifiedAt) {
        return true;
    }

    // Check if 24 hours have passed since last notification
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return lastNotifiedAt < twentyFourHoursAgo;
}

/**
 * Send ONE directional friend-feed notification: from `ownerUserId`'s point of
 * view about `otherUserId`, gated by that direction's own relationship record.
 *
 * The four-step dance — read the owner→other relationship, apply the 24h /
 * not-rejected `shouldSendNotification` gate, post the feed item (repeat-keyed
 * `${kind}_${otherUserId}` so re-runs dedupe), and stamp `lastNotifiedAt` — was
 * written out three times (once for a friend request, twice for the two sides
 * of an established friendship). Concentrating it here means the gate + feed +
 * timestamp invariant lives in one place; the two entry points below just name
 * the direction(s) and the notification kind.
 */
async function sendOneWayFriendNotification(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    otherUserId: string,
    kind: "friend_request" | "friend_accepted"
): Promise<void> {
    const relationship = await tx.userRelationship.findUnique({
        where: {
            fromUserId_toUserId: {
                fromUserId: ownerUserId,
                toUserId: otherUserId
            }
        }
    });

    if (!relationship || !shouldSendNotification(
        relationship.lastNotifiedAt,
        relationship.status
    )) {
        return;
    }

    await feedPost(
        tx,
        Context.create(ownerUserId),
        {
            kind,
            uid: otherUserId
        },
        `${kind}_${otherUserId}` // repeatKey to avoid duplicates
    );

    await tx.userRelationship.update({
        where: {
            fromUserId_toUserId: {
                fromUserId: ownerUserId,
                toUserId: otherUserId
            }
        },
        data: {
            lastNotifiedAt: new Date()
        }
    });
}

/**
 * Send a friend request notification to the receiver and update lastNotifiedAt.
 * This creates a feed item for the receiver about the incoming friend request.
 */
export async function sendFriendRequestNotification(
    tx: Prisma.TransactionClient,
    receiverUserId: string,
    senderUserId: string
): Promise<void> {
    await sendOneWayFriendNotification(
        tx,
        receiverUserId,
        senderUserId,
        "friend_request"
    );
}

/**
 * Send friendship established notifications to both users and update lastNotifiedAt.
 * This creates feed items for both users about the new friendship.
 */
export async function sendFriendshipEstablishedNotification(
    tx: Prisma.TransactionClient,
    user1Id: string,
    user2Id: string
): Promise<void> {
    await sendOneWayFriendNotification(tx, user1Id, user2Id, "friend_accepted");
    await sendOneWayFriendNotification(tx, user2Id, user1Id, "friend_accepted");
}