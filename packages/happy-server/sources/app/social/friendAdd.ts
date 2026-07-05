import { Context } from "@/context";
import { buildUserProfile, UserProfile } from "./type";
import { inTx } from "@/storage/inTx";
import { relationshipSet } from "./relationshipSet";
import { relationshipGet } from "./relationshipGet";
import { decideRelationshipTransition } from "./decideRelationshipTransition";
import { sendFriendRequestNotification, sendFriendshipEstablishedNotification } from "./friendNotification";

/**
 * Add a friend or accept a friend request.
 * Handles:
 * - Accepting incoming friend requests (both users become friends)
 * - Sending new friend requests
 * - Sending appropriate notifications with 24-hour cooldown
 */
export async function friendAdd(ctx: Context, uid: string): Promise<UserProfile | null> {
    // Prevent self-friendship
    if (ctx.uid === uid) {
        return null;
    }

    // Update relationship status
    return await inTx(async (tx) => {

        // Read current user objects
        const currentUser = await tx.account.findUnique({
            where: { id: ctx.uid },
            include: { githubUser: true }
        });
        const targetUser = await tx.account.findUnique({
            where: { id: uid },
            include: { githubUser: true }
        });
        if (!currentUser || !targetUser) {
            return null;
        }

        // Read relationship status
        const currentUserRelationship = await relationshipGet(tx, currentUser.id, targetUser.id);
        const targetUserRelationship = await relationshipGet(tx, targetUser.id, currentUser.id);

        // Decide the bidirectional transition, then apply its writes + notifications.
        const t = decideRelationshipTransition("add", currentUserRelationship, targetUserRelationship);
        if (t.currentNext !== undefined) {
            await relationshipSet(tx, currentUser.id, targetUser.id, t.currentNext);
        }
        if (t.targetNext !== undefined) {
            await relationshipSet(tx, targetUser.id, currentUser.id, t.targetNext);
        }
        if (t.notify === "friendship-established") {
            await sendFriendshipEstablishedNotification(tx, currentUser.id, targetUser.id);
        } else if (t.notify === "friend-request") {
            await sendFriendRequestNotification(tx, targetUser.id, currentUser.id);
        }

        return buildUserProfile(targetUser, t.resultStatus);
    });
}