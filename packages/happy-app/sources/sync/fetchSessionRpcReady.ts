export function resolveFetchedSessionRpcReady(
    existingSession: { rpcReady: boolean } | undefined,
): boolean {
    return existingSession?.rpcReady ?? false;
}
