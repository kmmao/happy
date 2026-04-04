/**
 * Handle session-event reports from CLI daemons.
 * Stores SessionEvent records and broadcasts to App clients.
 * Events are plaintext metadata (file edits, commands, tool calls).
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { eventRouter, buildSessionEventCreatedEphemeral } from "@/app/events/eventRouter";

const sessionEventSchema = z.object({
    sessionId: z.string().min(1),
    eventType: z.enum([
        "file_edit", "bash_command", "tool_call", "git_operation",
        "error", "session_start", "session_end",
    ]),
    summary: z.string().max(500),
    detail: z.record(z.string(), z.unknown()).optional(),
});

export function sessionEventHandler(socket: Socket, userId: string): void {
    socket.on("session-event", async (rawData: unknown) => {
        try {
            const parsed = sessionEventSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "timeline", level: "warn" },
                    `session-event: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            const data = parsed.data;

            // Verify session belongs to user
            const session = await db.session.findFirst({
                where: { id: data.sessionId, accountId: userId },
                select: { id: true },
            });
            if (!session) {
                log(
                    { module: "timeline", level: "warn" },
                    `session-event: session ${data.sessionId} not found for user ${userId}`,
                );
                return;
            }

            const event = await db.sessionEvent.create({
                data: {
                    sessionId: data.sessionId,
                    eventType: data.eventType,
                    summary: data.summary,
                    detail: data.detail ?? undefined,
                },
            });

            // Broadcast to App clients watching this session
            eventRouter.emitEphemeral({
                userId,
                payload: buildSessionEventCreatedEphemeral({
                    id: event.id,
                    sessionId: event.sessionId,
                    eventType: event.eventType,
                    summary: event.summary,
                    detail: (event.detail as Record<string, unknown>) ?? undefined,
                    createdAt: event.createdAt.getTime(),
                }),
                recipientFilter: {
                    type: "all-interested-in-session",
                    sessionId: data.sessionId,
                },
            });
        } catch (error) {
            log(
                { module: "timeline", level: "error" },
                `session-event handler error: ${error}`,
            );
        }
    });
}
