/**
 * Socket handler for the `session-adopt` event (Phase 2 / ADR-0024 §A6).
 *
 * Wire contract (happy-wire/sessionAdopt.ts):
 *   client emits → "session-adopt" with SessionAdoptRequest payload
 *   server callback ← SessionAdoptResponse (success+context+ownerId | error)
 *
 * Business logic lives in `@/modules/sessionAdopt`; this handler is a thin
 * wire-validation + transport layer per the project's "handler == orchestrator"
 * convention (see e.g. sessionUpdateHandler.ts).
 *
 * The actual `Session.metadata.automationContext` write happens client-side
 * after this RPC returns — server never decrypts the metadata blob (encrypted
 * with the session's per-session key the server doesn't hold).
 */

import type { Socket } from "socket.io";
import { SessionAdoptRequestSchema } from "@kmmao/happy-wire";
import { sessionAdopt } from "@/modules/sessionAdopt";
import { log } from "@/utils/log";

export function sessionAdoptHandler(userId: string, socket: Socket) {
    socket.on(
        "session-adopt",
        async (data: unknown, callback?: (response: unknown) => void) => {
            try {
                const parsed = SessionAdoptRequestSchema.safeParse(data);
                if (!parsed.success) {
                    callback?.({
                        success: false,
                        errorMessage: "Invalid request payload",
                        errorCode: "invalid_request",
                    });
                    return;
                }
                const result = await sessionAdopt({
                    userId,
                    request: parsed.data,
                });
                callback?.(result.response);
            } catch (error) {
                log(
                    { module: "session-adopt", level: "error" },
                    `session-adopt failed: ${error}`,
                );
                callback?.({
                    success: false,
                    errorMessage: "Internal error",
                    errorCode: "internal_error",
                });
            }
        },
    );
}
