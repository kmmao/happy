/**
 * Poll `isReady` until it returns true, or the timeout elapses.
 *
 * Freshly-spawned sessions register their daemon-side RPC handlers
 * asynchronously (signalled via the `rpc-ready` ephemeral event, surfaced on
 * the store as `session.rpcReady`). Session RPCs such as `getUploadDir` /
 * `writeFile` — used by image upload — silently fail until then, so callers
 * that need the daemon should await this first, e.g.:
 *
 *   await waitForSessionRpcReady(
 *       () => storage.getState().sessions[sessionId]?.rpcReady ?? false,
 *       30_000,
 *   );
 *
 * Returns true if `isReady` became true within the timeout, false on timeout
 * (the caller may still attempt the operation as a best effort).
 *
 * Kept free of store imports so it stays a pure, unit-testable primitive.
 */
export async function waitForSessionRpcReady(
    isReady: () => boolean,
    timeoutMs: number,
    pollIntervalMs: number = 150,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        if (isReady()) {
            return true;
        }
        if (Date.now() >= deadline) {
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}
