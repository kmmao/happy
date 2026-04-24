/**
 * Per-user, per-method rate limit for Socket.IO RPC forwarding.
 *
 * Currently scoped to the two claude-control file-access RPCs introduced in
 * SDK 0.2.119 (IMPLEMENTATION_GUIDE follow-up). Other methods pass through
 * unlimited. Fixed-window counter in-memory — simpler than sliding window,
 * sufficient for basic abuse prevention. Not persistent: if the server
 * restarts, counters reset (acceptable trade-off vs. Redis complexity for
 * this surface).
 *
 * Multi-instance note: counters are per-process. If the server runs behind
 * multiple nodes, the effective limit becomes `nodes × max`. Acceptable for
 * the current single-node deployment; move to Redis if/when we scale out.
 */

interface RpcRateLimitRule {
    /** Maximum number of requests per window. */
    max: number;
    /** Window length in milliseconds. */
    windowMs: number;
}

/**
 * Keyed by the bare method name (stripped of any `<sessionId>:` prefix).
 * Only matching methods are gated; everything else passes through.
 */
const RULES: Record<string, RpcRateLimitRule> = {
    "claude-control:read_file": { max: 20, windowMs: 60_000 },
    "claude-control:file_suggestions": { max: 60, windowMs: 60_000 },
};

interface Counter {
    count: number;
    windowStart: number;
}

const counters = new Map<string, Counter>();

/**
 * Strip the optional `<scopeId>:` prefix (sessionId / machineId) from a
 * qualified method name. Mirrors `getScopeId` in rpcHandler.
 */
function bareMethod(qualifiedMethod: string): string {
    const firstColon = qualifiedMethod.indexOf(":");
    if (firstColon <= 0) return qualifiedMethod;
    return qualifiedMethod.substring(firstColon + 1);
}

export interface RpcRateLimitResult {
    allowed: boolean;
    /** When denied, seconds until the user may retry. */
    retryInSec?: number;
    /** When denied, human-readable summary for logging / error propagation. */
    reason?: string;
}

/**
 * Check and record one RPC invocation against the configured rules.
 * Returns `{ allowed: true }` immediately for any method not in RULES.
 */
export function checkRpcRateLimit(
    userId: string,
    qualifiedMethod: string,
): RpcRateLimitResult {
    const method = bareMethod(qualifiedMethod);
    const rule = RULES[method];
    if (!rule) return { allowed: true };

    const key = `${userId}:${method}`;
    const now = Date.now();
    const entry = counters.get(key);

    if (!entry || now - entry.windowStart >= rule.windowMs) {
        counters.set(key, { count: 1, windowStart: now });
        return { allowed: true };
    }

    if (entry.count >= rule.max) {
        const retryInSec = Math.max(
            1,
            Math.ceil((entry.windowStart + rule.windowMs - now) / 1000),
        );
        return {
            allowed: false,
            retryInSec,
            reason: `${method} exceeds ${rule.max} req / ${rule.windowMs / 1000}s per user`,
        };
    }

    entry.count += 1;
    return { allowed: true };
}

/**
 * Exposed for tests. Do NOT call from production code paths.
 */
export function __resetRpcRateLimitForTests(): void {
    counters.clear();
}
