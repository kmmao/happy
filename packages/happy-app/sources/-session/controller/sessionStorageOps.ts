/**
 * SessionStorageOps — the narrow storage interface SessionController is
 * constructed with (see CONTEXT.md "SessionController").
 *
 * The controller must NOT see the full Zustand singleton: it needs one
 * subscribe plus a handful of per-session reads and writes. Production wires
 * `adaptStorage(storage)`; tests wire an in-memory fake. Keeping the surface
 * this small is what makes the controller's protocol invariants testable
 * without standing up the 3k-line store.
 */

import type { Session } from "@/sync/storageTypes";

export interface PendingQueueItem {
    localId: string;
    message: string;
    displayText?: string;
}

export interface SessionStorageOps {
    /** Subscribe to any store change; returns the unsubscribe. */
    subscribe(cb: () => void): () => void;
    getQueue(sessionId: string): readonly PendingQueueItem[];
    getPaused(sessionId: string): boolean;
    getSession(sessionId: string): Session | null;

    appendToPendingQueue(sessionId: string, item: PendingQueueItem): void;
    updatePendingQueueItem(
        sessionId: string,
        localId: string,
        patch: { message: string; displayText?: string },
    ): boolean;
    reorderPendingQueueItemToFront(sessionId: string, localId: string): void;
    removePendingQueueItem(sessionId: string, localId: string): void;
    clearPendingQueue(sessionId: string): void;
    setPendingQueuePaused(sessionId: string, paused: boolean): void;

    updateSessionPermissionMode(sessionId: string, mode: string): void;
    updateSessionModelMode(sessionId: string, mode: string): void;
}

/**
 * The store shape adaptStorage needs — structurally satisfied by the app's
 * Zustand store (`storage`) without importing its concrete type, so this
 * module cannot grow a dependency on store internals.
 */
interface StorageLike {
    subscribe(cb: () => void): () => void;
    getState(): {
        sessionPendingQueues: Record<string, PendingQueueItem[]>;
        sessionPendingQueuePaused: Record<string, boolean>;
        sessions: Record<string, Session>;
        appendToPendingQueue(sessionId: string, item: PendingQueueItem): void;
        updatePendingQueueItem(
            sessionId: string,
            localId: string,
            patch: { message: string; displayText?: string },
        ): boolean;
        reorderPendingQueueItemToFront(sessionId: string, localId: string): void;
        removePendingQueueItem(sessionId: string, localId: string): void;
        clearPendingQueue(sessionId: string): void;
        setPendingQueuePaused(sessionId: string, paused: boolean): void;
        updateSessionPermissionMode(sessionId: string, mode: string): void;
        updateSessionModelMode(sessionId: string, mode: string): void;
    };
}

const EMPTY_QUEUE: readonly PendingQueueItem[] = [];

/** Adapt the app's Zustand store to the narrow SessionStorageOps surface. */
export function adaptStorage(store: StorageLike): SessionStorageOps {
    return {
        subscribe: (cb) => store.subscribe(cb),
        getQueue: (sessionId) =>
            store.getState().sessionPendingQueues[sessionId] ?? EMPTY_QUEUE,
        getPaused: (sessionId) =>
            store.getState().sessionPendingQueuePaused[sessionId] ?? false,
        getSession: (sessionId) => store.getState().sessions[sessionId] ?? null,

        appendToPendingQueue: (sessionId, item) =>
            store.getState().appendToPendingQueue(sessionId, item),
        updatePendingQueueItem: (sessionId, localId, patch) =>
            store.getState().updatePendingQueueItem(sessionId, localId, patch),
        reorderPendingQueueItemToFront: (sessionId, localId) =>
            store.getState().reorderPendingQueueItemToFront(sessionId, localId),
        removePendingQueueItem: (sessionId, localId) =>
            store.getState().removePendingQueueItem(sessionId, localId),
        clearPendingQueue: (sessionId) =>
            store.getState().clearPendingQueue(sessionId),
        setPendingQueuePaused: (sessionId, paused) =>
            store.getState().setPendingQueuePaused(sessionId, paused),

        updateSessionPermissionMode: (sessionId, mode) =>
            store.getState().updateSessionPermissionMode(sessionId, mode),
        updateSessionModelMode: (sessionId, mode) =>
            store.getState().updateSessionModelMode(sessionId, mode),
    };
}
