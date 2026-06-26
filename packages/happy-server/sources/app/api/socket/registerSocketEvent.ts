/**
 * registerSocketEvent — the inbound counterpart to the emitSyncUpdate /
 * emitSyncEphemeral seams (ADR-0023 / ADR-0024).
 *
 * Every fire-and-forget daemon→server signal (task-status, supervisor-*-status,
 * webhook-status, session-event, inter-agent session:message) repeats the same
 * wrapper around its real work:
 *
 *   socket.on(event, async (rawData) => {
 *     try {
 *       const parsed = schema.safeParse(rawData)
 *       if (!parsed.success) { log warn `${event}: invalid data: ...`; return }
 *       ...business...
 *     } catch (error) { log error `${event} handler error: ${error}` }
 *   })
 *
 * The wrapper is pure boilerplate — the leverage lives in the business handler.
 * This seam owns the boilerplate once: registration, Zod validation with the
 * standard `invalid data` warn-and-drop, and the catch-all `handler error`
 * log that keeps a single malformed/throwing payload from taking down the
 * socket. Each call supplies its own `module` log tag and typed `handler`,
 * which receives the validated `data` plus `{ userId, socket }` context.
 *
 * Scope: ONLY the fire-and-forget variant (no acknowledgement callback). The
 * request/response handlers that take a `callback` (session update/adopt/
 * preferences, machine update, knowledge, preview-proxy) carry an additional
 * response contract and stay on the RPC path (ADR-0035) — they are NOT this
 * seam's adapters.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { log } from "@/utils/log";

export interface SocketEventContext {
    userId: string;
    socket: Socket;
}

export function registerSocketEvent<S extends z.ZodTypeAny>(opts: {
    socket: Socket;
    userId: string;
    /** Socket.IO event name, e.g. "task-status". Also templates the log lines. */
    event: string;
    /** Zod schema the raw payload must satisfy before `handler` runs. */
    schema: S;
    /** `log` module tag for this handler's warn/error lines (e.g. "task"). */
    module: string;
    /** Business logic. Runs only on a valid payload; throws are caught + logged. */
    handler: (data: z.infer<S>, ctx: SocketEventContext) => Promise<void> | void;
}): void {
    const { socket, userId, event, schema, module, handler } = opts;
    socket.on(event, async (rawData: unknown) => {
        try {
            const parsed = schema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module, level: "warn" },
                    `${event}: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            await handler(parsed.data, { userId, socket });
        } catch (error) {
            log(
                { module, level: "error" },
                `${event} handler error: ${error}`,
            );
        }
    });
}
