/**
 * Handle webhook-status events from CLI daemons.
 * Updates WebhookEvent records with completion/failure status.
 */

import { Socket } from "socket.io";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

export function webhookStatusHandler(
    socket: Socket,
    userId: string,
): void {
    socket.on(
        "webhook-status",
        async (data: {
            webhookEventId: string;
            status: "dispatched" | "completed" | "failed";
            sessionId?: string;
            errorMessage?: string;
        }) => {
            try {
                const event = await db.webhookEvent.findFirst({
                    where: {
                        id: data.webhookEventId,
                        accountId: userId,
                    },
                });

                if (!event) {
                    log(
                        { module: "webhook", level: "warn" },
                        `webhook-status: event ${data.webhookEventId} not found for user ${userId}`,
                    );
                    return;
                }

                await db.webhookEvent.update({
                    where: { id: data.webhookEventId },
                    data: {
                        status: data.status,
                        sessionId: data.sessionId ?? event.sessionId,
                        errorMessage:
                            data.errorMessage ?? event.errorMessage,
                    },
                });

                log(
                    { module: "webhook" },
                    `webhook-status: event ${data.webhookEventId} → ${data.status}`,
                );
            } catch (error) {
                log(
                    { module: "webhook", level: "error" },
                    `webhook-status handler error: ${error}`,
                );
            }
        },
    );
}
