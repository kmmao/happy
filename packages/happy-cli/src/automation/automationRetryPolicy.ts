/**
 * Automation job retry policy — decides whether a failed job retries and when.
 *
 * Extracted from `AutomationScheduler.dispatch`'s catch handler, where the
 * `attempt < maxAttempts` decision and the `attempt * step` backoff math were
 * inlined next to the persistence writes (`store.upsert`, `notifyChange`,
 * `reportTaskStatus`). That coupling meant the retry contract — the boundary at
 * `attempt === maxAttempts`, and the linear backoff schedule — could only be
 * exercised by driving the whole scheduler through a real failure. As its own
 * pure seam (`evaluateRetry(now, attempt, maxAttempts) → { retry, nextRunAt }`)
 * every edge is directly testable, matching the `agentLoopAutoRunPolicy` seam
 * (ADR-0050). No behavior change: the arithmetic moved verbatim.
 */

/** Linear backoff step: the Nth retry waits `attempt * this` ms. */
export const RETRY_BACKOFF_STEP_MS = 5_000;

/** True while the job still has attempts left. */
export function shouldRetry(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts;
}

/**
 * When the next retry should run (`now + attempt * RETRY_BACKOFF_STEP_MS`), or
 * `undefined` when the job is out of attempts and should stay failed.
 */
export function computeNextRunAt(
  now: number,
  attempt: number,
  maxAttempts: number,
): number | undefined {
  return shouldRetry(attempt, maxAttempts)
    ? now + attempt * RETRY_BACKOFF_STEP_MS
    : undefined;
}

/** The full retry decision for a failed job. */
export function evaluateRetry(
  now: number,
  attempt: number,
  maxAttempts: number,
): { retry: boolean; nextRunAt: number | undefined } {
  const retry = shouldRetry(attempt, maxAttempts);
  return {
    retry,
    nextRunAt: retry ? now + attempt * RETRY_BACKOFF_STEP_MS : undefined,
  };
}
