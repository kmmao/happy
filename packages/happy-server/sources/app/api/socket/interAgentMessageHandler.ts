/**
 * Route inter-agent messages between sessions within the same user account.
 * A session-scoped CLI client emits "session:message" to forward a plaintext
 * status string to another session. The server validates ownership, then
 * delivers an "inter-agent-message" ephemeral to the target session's clients.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";

const interAgentMessageSchema = z.object({
    fromSessionId: z.string().min(1),
    toSessionId: z.string().min(1),
    message: z.string().max(2000),
});

export function interAgentMessageHandler(socket: Socket, userId: string): void {
    socket.on("session:message", async (rawData: unknown) => {
        try {
            const parsed = interAgentMessageSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "inter-agent", level: "warn" },
                    `session:message: invalid payload: ${parsed.error.message}`,
                );
                return;
            }
            const { fromSessionId, toSessionId, message } = parsed.data;

            // Verify both sessions belong to this user
            const [fromSession, toSession] = await Promise.all([
                db.session.findFirst({
                    where: { id: fromSessionId, accountId: userId },
                    select: { id: true },
                }),
                db.session.findFirst({
                    where: { id: toSessionId, accountId: userId },
                    select: { id: true },
                }),
            ]);

            if (!fromSession) {
                log(
                    { module: "inter-agent", level: "warn" },
                    `session:message: fromSession ${fromSessionId} not found for user ${userId}`,
                );
                return;
            }
            if (!toSession) {
                log(
                    { module: "inter-agent", level: "warn" },
                    `session:message: toSession ${toSessionId} not found for user ${userId}`,
                );
                return;
            }

            // Per ADR-0024 E3: the two emits below are split at the seam
            // discriminator (-deliver to the target Session, -echo back to
            // the sender's user-scoped App) but both wire-emit the same
            // `type: "inter-agent-message"` payload — clients see no event
            // type change.
            await emitSyncEphemeral(userId, {
                t: "inter-agent-message-deliver",
                fromSessionId,
                toSessionId,
                message,
            });
            await emitSyncEphemeral(userId, {
                t: "inter-agent-message-echo",
                fromSessionId,
                toSessionId,
                message,
            });
        } catch (error) {
            log(
                { module: "inter-agent", level: "error" },
                `session:message handler error: ${error}`,
            );
        }
    });
}
