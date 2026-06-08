import { Context } from "@/context";
import { FeedBody, UserFeedItem } from "./types";
import { Tx } from "@/storage/inTx";
import { emitSyncUpdate } from "@/app/events/syncUpdate";

/**
 * Add a post to user's feed.
 * If repeatKey is provided and exists, the post will be updated in-place.
 * Otherwise, a new post is created with an incremented counter.
 */
export async function feedPost(
    tx: Tx,
    ctx: Context,
    body: FeedBody,
    repeatKey?: string | null
): Promise<UserFeedItem> {


    // Delete existing items with the same repeatKey
    if (repeatKey) {
        await tx.userFeedItem.deleteMany({
            where: {
                userId: ctx.uid,
                repeatKey: repeatKey
            }
        });
    }

    // Allocate new counter
    const user = await tx.account.update({
        where: { id: ctx.uid },
        select: { feedSeq: true },
        data: { feedSeq: { increment: 1 } }
    });

    // Create new item
    const item = await tx.userFeedItem.create({
        data: {
            counter: user.feedSeq,
            userId: ctx.uid,
            repeatKey: repeatKey,
            body: body
        }
    });

    const result = {
        ...item,
        createdAt: item.createdAt.getTime(),
        cursor: '0-' + item.counter.toString(10)
    };

    // Broadcast after the surrounding tx commits. The seam (ADR-0023) owns
    // seq + id + recipient + afterTx wrapping; passing { tx } defers emission.
    await emitSyncUpdate(ctx.uid, { t: "new-feed-post", post: result }, { tx });

    return result;
}