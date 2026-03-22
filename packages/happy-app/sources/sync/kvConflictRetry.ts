import type { AuthCredentials } from '@/auth/tokenStorage';
import { kvMutate } from './apiKv';

const BASE_DELAY_MS = 100;
const PER_CALL_TIMEOUT_MS = 10_000;

export interface KvSetWithRetryResult {
    version: number;
    conflictOccurred: boolean;
}

/**
 * Race a promise against a timeout. Rejects with a clear error if timeout
 * is reached, preventing `backoff()`'s infinite retry loop from blocking
 * the caller indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`KV mutate timed out after ${ms}ms`)),
            ms,
        );
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

/**
 * Write a single KV key with automatic retry on version-mismatch.
 *
 * Uses last-writer-wins strategy: on conflict the local value is re-sent
 * with the server's current version. Retries use exponential backoff
 * (100ms → 200ms → 400ms …) to reduce contention.
 *
 * Each `kvMutate` call is wrapped in a 10 s timeout to prevent
 * `backoff()`'s infinite-retry loop from blocking forever.
 * Network / unexpected errors are propagated immediately without retry.
 */
export async function kvSetWithRetry(
    credentials: AuthCredentials,
    key: string,
    value: string,
    currentVersion: number,
    options?: { maxRetries?: number },
): Promise<KvSetWithRetryResult> {
    const maxRetries = options?.maxRetries ?? 3;

    let version = currentVersion;
    let conflictOccurred = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await withTimeout(
            kvMutate(credentials, [{ key, value, version }]),
            PER_CALL_TIMEOUT_MS,
        );

        if (result.success) {
            return {
                version: result.results[0].version,
                conflictOccurred,
            };
        }

        // Version mismatch — update version from server response and retry
        const serverVersion = result.errors[0].version;
        version = serverVersion;
        conflictOccurred = true;

        // Last attempt exhausted — no more retries
        if (attempt === maxRetries) {
            break;
        }

        // Exponential backoff before next retry
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error(
        `KV set failed after ${maxRetries} retries: version-mismatch on key "${key}"`,
    );
}
