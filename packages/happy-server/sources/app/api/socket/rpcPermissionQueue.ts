import { log } from "@/utils/log";
import { Socket } from "socket.io";

/**
 * In-memory queue for permission RPC responses when the daemon socket is offline.
 *
 * Flow:
 *   1. App sends "rpc-call" for {sessionId}:permission but daemon is not connected.
 *   2. rpcHandler enqueues the response via enqueuePermissionResponse().
 *   3. When the daemon re-registers the same method via "rpc-register",
 *      rpcHandler calls flushPermissionQueue() to forward all pending responses.
 *   4. TTL: entries older than QUEUE_TTL_MS are discarded automatically.
 *
 * Design notes:
 *   - In-memory only — intentionally not persisted. Server restart clears the queue
 *     and the App will surface the permission card again for retry.
 *   - Scoped per qualified method name (e.g. "abc123:permission") to avoid
 *     cross-session leakage.
 *   - Only ":permission" methods are queued; other methods fail fast as before.
 */

const QUEUE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface QueuedPermissionCall {
    params: string;            // Already encrypted params from the App
    queuedAt: number;          // Unix ms timestamp
}

/** Map<qualifiedMethod, QueuedPermissionCall[]> */
const queue = new Map<string, QueuedPermissionCall[]>();

/** Remove entries older than QUEUE_TTL_MS from all method queues. */
function evictExpired(): void {
    const now = Date.now();
    for (const [method, calls] of queue.entries()) {
        const fresh = calls.filter((c) => now - c.queuedAt < QUEUE_TTL_MS);
        if (fresh.length === 0) {
            queue.delete(method);
        } else if (fresh.length !== calls.length) {
            queue.set(method, fresh);
        }
    }
}

/**
 * Returns true when the qualified method name is eligible for queuing.
 * Currently only ":permission" calls are queued.
 */
export function isQueueableMethod(qualifiedMethod: string): boolean {
    return qualifiedMethod.endsWith(":permission");
}

/**
 * Enqueue a permission response for later delivery.
 * Called by rpcHandler when the target daemon socket is unavailable.
 */
export function enqueuePermissionResponse(
    qualifiedMethod: string,
    params: string,
): void {
    evictExpired();
    const entry: QueuedPermissionCall = { params, queuedAt: Date.now() };
    const existing = queue.get(qualifiedMethod) ?? [];
    queue.set(qualifiedMethod, [...existing, entry]);
    log(
        { module: "rpc-queue", level: "info" },
        `Permission response queued for ${qualifiedMethod} (queue depth: ${existing.length + 1})`,
    );
}

/**
 * Flush all queued permission responses for the given method to the newly
 * registered daemon socket. Called when the daemon re-registers the method.
 *
 * Returns the number of responses forwarded.
 */
export async function flushPermissionQueue(
    qualifiedMethod: string,
    daemonSocket: Socket,
): Promise<number> {
    evictExpired();
    const pending = queue.get(qualifiedMethod);
    if (!pending || pending.length === 0) return 0;

    // Remove from queue before forwarding (prevent double-delivery on error)
    queue.delete(qualifiedMethod);

    let forwarded = 0;
    for (const call of pending) {
        try {
            await daemonSocket.timeout(30_000).emitWithAck("rpc-request", {
                method: qualifiedMethod,
                params: call.params,
            });
            forwarded++;
            log(
                { module: "rpc-queue", level: "info" },
                `Queued permission response delivered for ${qualifiedMethod} (age: ${Date.now() - call.queuedAt}ms)`,
            );
        } catch (err) {
            log(
                { module: "rpc-queue", level: "warn" },
                `Failed to deliver queued permission response for ${qualifiedMethod}: ${err}`,
            );
        }
    }

    return forwarded;
}

/** Exposed for tests. */
export function _getQueueDepth(qualifiedMethod: string): number {
    return queue.get(qualifiedMethod)?.length ?? 0;
}
