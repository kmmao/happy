import { buildUpdateSessionUpdate, ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { allocateUserSeq } from "@/storage/seq";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { Socket } from "socket.io";

export function sessionPreferencesHandler(userId: string, socket: Socket, connection: ClientConnection) {
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

            // Resolve session
            const session = await db.session.findUnique({
                where: { id: sid, accountId: userId }
            });
            if (!session) {
                if (callback) {
                    callback({ result: 'error' });
                }
                return;
            }

            // Check version
            if (session.preferencesVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: session.preferencesVersion, preferences: session.preferences });
                return;
            }

            // Update preferences
            const { count } = await db.session.updateMany({
                where: { id: sid, preferencesVersion: expectedVersion },
                data: {
                    preferences: preferences,
                    preferencesVersion: expectedVersion + 1
                }
            });
            if (count === 0) {
                callback({ result: 'version-mismatch', version: session.preferencesVersion, preferences: session.preferences });
                return;
            }

            // Generate session preferences update
            const updSeq = await allocateUserSeq(userId);
            const preferencesUpdate = {
                value: preferences,
                version: expectedVersion + 1
            };
            const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, undefined, preferencesUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
            });

            // Send success response with new version via callback
            callback({ result: 'success', version: expectedVersion + 1, preferences: preferences });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-preferences: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });
}
