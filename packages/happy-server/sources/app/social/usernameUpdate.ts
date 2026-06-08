import { db } from "@/storage/db";
import { Context } from "@/context";
import { emitSyncUpdate } from "@/app/events/syncUpdate";

export async function usernameUpdate(ctx: Context, username: string): Promise<void> {
    const userId = ctx.uid;

    // Check if username is already taken
    const existingUser = await db.account.findFirst({
        where: {
            username: username,
            NOT: { id: userId }
        }
    });
    if (existingUser) { // Should never happen
        throw new Error('Username is already taken');
    }

    // Update username
    await db.account.update({
        where: { id: userId },
        data: { username: username }
    });

    // Broadcast the account change. The seam (ADR-0023) owns seq + id +
    // recipient set + payload assembly; this call site only expresses the
    // domain fact.
    await emitSyncUpdate(userId, { t: "update-account", profile: { username } });
}