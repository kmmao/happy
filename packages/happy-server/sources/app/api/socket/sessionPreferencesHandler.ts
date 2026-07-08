import { ClientConnection } from "@/app/events/eventRouter";
import { log } from "@/utils/log";
import { Socket } from "socket.io";
import { sessionVersionedFieldUpdate } from "./sessionVersionedFieldUpdate";

export function sessionPreferencesHandler(userId: string, socket: Socket, _connection: ClientConnection) {
    socket.on('update-preferences', async (data: any, callback: (response: any) => void) => {
        try {
            const { sid, preferences, expectedVersion } = data;

            // Validate input
            if (!sid || typeof preferences !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) {
                    callback({ result: 'error' });
                }
                return;
            }

            // The compare-and-swap + version-mismatch/success/error acknowledgement
            // and the update-session broadcast all live in the shared seam so
            // preferences cannot drift from metadata/agentState (ADR-0075).
            await sessionVersionedFieldUpdate({
                userId,
                sid,
                field: 'preferences',
                value: preferences,
                expectedVersion,
                callback,
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-preferences: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });
}
