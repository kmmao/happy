import { websocketEventsCounter } from "@/app/monitoring/metrics2";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { Socket } from "socket.io";
import * as privacyKit from "privacy-kit";
import { artifactVersionedUpdate } from "@/app/api/artifact/artifactVersionedUpdate";
import { artifactCreate } from "@/app/api/artifact/artifactCreate";

export function artifactUpdateHandler(userId: string, socket: Socket) {
    // Read artifact with full body
    socket.on('artifact-read', async (data: {
        artifactId: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-read' });

            const { artifactId } = data;

            // Validate input
            if (!artifactId) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Fetch artifact
            const artifact = await db.artifact.findFirst({
                where: {
                    id: artifactId,
                    accountId: userId
                }
            });

            if (!artifact) {
                if (callback) {
                    callback({ result: 'error', message: 'Artifact not found' });
                }
                return;
            }

            // Return artifact data
            callback({
                result: 'success',
                artifact: {
                    id: artifact.id,
                    header: privacyKit.encodeBase64(artifact.header),
                    headerVersion: artifact.headerVersion,
                    body: privacyKit.encodeBase64(artifact.body),
                    bodyVersion: artifact.bodyVersion,
                    seq: artifact.seq,
                    createdAt: artifact.createdAt.getTime(),
                    updatedAt: artifact.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-read: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Update artifact with optimistic concurrency control
    socket.on('artifact-update', async (data: {
        artifactId: string;
        header?: {
            data: string;
            expectedVersion: number;
        };
        body?: {
            data: string;
            expectedVersion: number;
        };
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-update' });

            const { artifactId, header, body } = data;

            // Validate input
            if (!artifactId) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // At least one update must be provided
            if (!header && !body) {
                if (callback) {
                    callback({ result: 'error', message: 'No updates provided' });
                }
                return;
            }

            // Validate header structure if provided
            if (header && (typeof header.data !== 'string' || typeof header.expectedVersion !== 'number')) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid header parameters' });
                }
                return;
            }

            // Validate body structure if provided
            if (body && (typeof body.data !== 'string' || typeof body.expectedVersion !== 'number')) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid body parameters' });
                }
                return;
            }

            // Delegate the optimistic-concurrency CAS to the deep module; here
            // we only shape the socket callback for each outcome.
            const result = await artifactVersionedUpdate({
                artifactId,
                userId,
                header,
                body,
            });

            if (!result.applied) {
                if (result.reason === 'not-found') {
                    callback({ result: 'error', message: 'Artifact not found' });
                    return;
                }
                const response: any = { result: 'version-mismatch' };
                if (result.header) {
                    response.header = {
                        currentVersion: result.header.currentVersion,
                        currentData: result.header.currentData,
                    };
                }
                if (result.body) {
                    response.body = {
                        currentVersion: result.body.currentVersion,
                        currentData: result.body.currentData,
                    };
                }
                callback(response);
                return;
            }

            // Emit update event
            const headerUpdate = result.headerVersion !== undefined && header
                ? { value: header.data, version: result.headerVersion }
                : undefined;
            const bodyUpdate = result.bodyVersion !== undefined && body
                ? { value: body.data, version: result.bodyVersion }
                : undefined;
            await emitSyncUpdate(userId, {
                t: "update-artifact",
                artifactId,
                header: headerUpdate,
                body: bodyUpdate,
            });

            // Send success response
            const response: any = { result: 'success' };
            if (headerUpdate) {
                response.header = {
                    version: headerUpdate.version,
                    data: header!.data
                };
            }
            if (bodyUpdate) {
                response.body = {
                    version: bodyUpdate.version,
                    data: body!.data
                };
            }
            callback(response);
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-update: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Create new artifact
    socket.on('artifact-create', async (data: {
        id: string;
        header: string;
        body: string;
        dataEncryptionKey: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-create' });

            const { id, header, body, dataEncryptionKey } = data;

            // Validate input
            if (!id || typeof header !== 'string' || typeof body !== 'string' || typeof dataEncryptionKey !== 'string') {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Intake (existence check, conflict rule, idempotency, initial row
            // shape, new-artifact broadcast) lives in the artifactCreate seam.
            const result = await artifactCreate({
                accountId: userId,
                id,
                header,
                body,
                dataEncryptionKey,
            });

            if (result.status === 'conflict') {
                if (callback) {
                    callback({ result: 'error', message: 'Artifact with this ID already exists for another account' });
                }
                return;
            }

            const artifact = result.artifact;
            callback({
                result: 'success',
                artifact: {
                    id: artifact.id,
                    header: privacyKit.encodeBase64(artifact.header),
                    headerVersion: artifact.headerVersion,
                    body: privacyKit.encodeBase64(artifact.body),
                    bodyVersion: artifact.bodyVersion,
                    seq: artifact.seq,
                    createdAt: artifact.createdAt.getTime(),
                    updatedAt: artifact.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-create: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Delete artifact
    socket.on('artifact-delete', async (data: {
        artifactId: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-delete' });

            const { artifactId } = data;

            // Validate input
            if (!artifactId) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Check if artifact exists and belongs to user
            const artifact = await db.artifact.findFirst({
                where: {
                    id: artifactId,
                    accountId: userId
                }
            });

            if (!artifact) {
                if (callback) {
                    callback({ result: 'error', message: 'Artifact not found' });
                }
                return;
            }

            // Delete artifact
            await db.artifact.delete({
                where: { id: artifactId }
            });

            // Broadcast delete-artifact. Seam owns seq + id + recipient (ADR-0023).
            await emitSyncUpdate(userId, { t: "delete-artifact", artifactId });

            // Send success response
            callback({ result: 'success' });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-delete: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });
}