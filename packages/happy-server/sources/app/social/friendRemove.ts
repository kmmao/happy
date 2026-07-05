import { Context } from "@/context";
import { buildUserProfile, UserProfile } from "./type";
import { inTx } from "@/storage/inTx";
import { relationshipSet } from "./relationshipSet";
import { relationshipGet } from "./relationshipGet";
import { decideRelationshipTransition } from "./decideRelationshipTransition";

export async function friendRemove(ctx: Context, uid: string): Promise<UserProfile | null> {
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

        // Decide the bidirectional transition, then apply its writes.
        const t = decideRelationshipTransition("remove", currentUserRelationship, targetUserRelationship);
        if (t.currentNext !== undefined) {
            await relationshipSet(tx, currentUser.id, targetUser.id, t.currentNext);
        }
        if (t.targetNext !== undefined) {
            await relationshipSet(tx, targetUser.id, currentUser.id, t.targetNext);
        }

        return buildUserProfile(targetUser, t.resultStatus);
    });
}