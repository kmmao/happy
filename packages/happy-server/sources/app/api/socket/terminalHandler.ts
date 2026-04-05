import { Socket } from "socket.io";
import { eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

const MAX_TERMINAL_CHUNK = 16 * 1024; // 16KB safety limit

/**
 * Relays terminal I/O events between CLI daemons and App clients.
 *
 * terminal-output: CLI daemon → Server → App (PTY output)
 * terminal-exit:   CLI daemon → Server → App (PTY exited)
 * terminal-input:  App → Server → CLI daemon (keyboard/paste input)
 *
 * All events are ephemeral (not persisted) and sent over authenticated TLS.
 */
export function terminalHandler(userId: string, socket: Socket) {
    // --- CLI → App: terminal output ---
    socket.on("terminal-output", (payload: {
        machineId: string;
        terminalId: string;
        data: string;
    }) => {
        try {
            if (!payload?.machineId || !payload?.terminalId || typeof payload.data !== "string") {
                return;
            }
            if (payload.data.length > MAX_TERMINAL_CHUNK) {
                return;
            }
            eventRouter.emitEphemeral({
                userId,
                payload: {
                    type: "terminal-output",
                    machineId: payload.machineId,
                    terminalId: payload.terminalId,
                    data: payload.data,
                },
                recipientFilter: { type: "user-scoped-only" },
            });
        } catch (error) {
            log({ module: "websocket", level: "error" }, `Error in terminal-output handler: ${error}`);
        }
    });

    // --- CLI → App: terminal exited ---
    socket.on("terminal-exit", (payload: {
        machineId: string;
        terminalId: string;
        exitCode: number;
    }) => {
        try {
            if (!payload?.machineId || !payload?.terminalId) {
                return;
            }
            eventRouter.emitEphemeral({
                userId,
                payload: {
                    type: "terminal-exit",
                    machineId: payload.machineId,
                    terminalId: payload.terminalId,
                    exitCode: payload.exitCode ?? -1,
                },
                recipientFilter: { type: "user-scoped-only" },
            });
        } catch (error) {
            log({ module: "websocket", level: "error" }, `Error in terminal-exit handler: ${error}`);
        }
    });

    // --- App → CLI: terminal input ---
    socket.on("terminal-input", (payload: {
        machineId: string;
        terminalId: string;
        data: string;
    }) => {
        try {
            if (!payload?.machineId || !payload?.terminalId || typeof payload.data !== "string") {
                return;
            }
            // Limit input size (prevent abuse)
            if (payload.data.length > 4096) {
                return;
            }
            // Forward to the specific machine's daemon socket
            eventRouter.emitEphemeral({
                userId,
                payload: {
                    type: "terminal-input",
                    machineId: payload.machineId,
                    terminalId: payload.terminalId,
                    data: payload.data,
                },
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: payload.machineId,
                },
            });
        } catch (error) {
            log({ module: "websocket", level: "error" }, `Error in terminal-input handler: ${error}`);
        }
    });
}
