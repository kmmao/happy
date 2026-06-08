import { Socket } from "socket.io";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { activityCache } from "@/app/presence/sessionCache";
import { log } from "@/utils/log";

const MAX_CHUNK_BYTES = 16 * 1024; // 16KB — 2x CLI's 8KB limit for safety

/**
 * Forwards task-log events from CLI daemons to interested App clients.
 *
 * CLI emits: socket.volatile.emit("task-log", { sid, taskId, outputFile, chunk, offset })
 * Server forwards: emitEphemeral({ type: "task-log", sessionId, taskId, ... })
 * App listens: ephemeral event with type "task-log"
 *
 * Validates session ownership before forwarding.
 * Data is sent unencrypted (volatile, non-persisted, over authenticated TLS).
 */
export function taskLogHandler(userId: string, socket: Socket) {
    socket.on("task-log", async (payload: {
        sid: string;
        taskId: string;
        outputFile: string;
        chunk: string;
        offset: number;
    }) => {
        try {
            if (!payload || !payload.sid || !payload.taskId || typeof payload.chunk !== "string") {
                return;
            }

            // HIGH-1: Reject oversized chunks
            if (payload.chunk.length > MAX_CHUNK_BYTES) {
                return;
            }

            // CRITICAL-3: Verify session belongs to this user via cache
            const isValid = await activityCache.isSessionValid(payload.sid, userId);
            if (!isValid) {
                return;
            }

            await emitSyncEphemeral(userId, {
                t: "task-log",
                sessionId: payload.sid,
                taskId: payload.taskId,
                outputFile: payload.outputFile,
                chunk: payload.chunk,
                offset: payload.offset,
            });
        } catch (error) {
            log({ module: "websocket", level: "error" }, `Error in task-log handler: ${error}`);
        }
    });
}
