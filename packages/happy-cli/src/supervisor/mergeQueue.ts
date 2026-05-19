/**
 * Per-branch merge queue for supervisor fix sessions.
 *
 * Serializes direct-mode fix sessions targeting the same parent branch
 * so only one can rebase + push at a time. PR-mode fixes bypass the queue.
 *
 * Orthogonal to concurrencyLimiter (which caps total active sessions).
 * This queue prevents rebase/push races on the same branch.
 */

import { logger } from "@/ui/logger";

interface QueueEntry {
  readonly actionId: string;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly abortHandler: (() => void) | null;
  readonly signal?: AbortSignal;
}

interface MergeLock {
  holder: string | null; // actionId of the session holding the lock
  readonly queue: QueueEntry[];
}

const locks = new Map<string, MergeLock>();

function getOrCreateLock(parentBranch: string): MergeLock {
  let lock = locks.get(parentBranch);
  if (!lock) {
    lock = { holder: null, queue: [] };
    locks.set(parentBranch, lock);
  }
  return lock;
}

/**
 * Acquire the merge lock for a parent branch.
 *
 * If no other fix session holds the lock, resolves immediately.
 * Otherwise, queues the caller and waits (FIFO).
 *
 * @param parentBranch - The branch being pushed to (e.g. "main")
 * @param actionId - Supervisor action ID (for logging and holder tracking)
 * @param signal - Optional AbortSignal to cancel while queued
 */
export function acquireMergeLock(
  parentBranch: string,
  actionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const lock = getOrCreateLock(parentBranch);

  // Fast path: no holder
  if (lock.holder === null) {
    lock.holder = actionId;
    logger.debug(
      `[MERGE-QUEUE] Acquired lock for ${parentBranch} (action: ${actionId})`,
    );
    return Promise.resolve();
  }

  // Already aborted
  if (signal?.aborted) {
    return Promise.reject(new MergeQueueAbortedError(parentBranch, actionId));
  }

  // Queue and wait
  return new Promise<void>((resolve, reject) => {
    const entry: QueueEntry = {
      actionId,
      resolve,
      reject,
      abortHandler: signal
        ? () => {
            const idx = lock.queue.indexOf(entry);
            if (idx !== -1) {
              lock.queue.splice(idx, 1);
            }
            reject(new MergeQueueAbortedError(parentBranch, actionId));
          }
        : null,
      signal,
    };

    if (signal && entry.abortHandler) {
      signal.addEventListener("abort", entry.abortHandler, { once: true });
    }

    lock.queue.push(entry);
    logger.debug(
      `[MERGE-QUEUE] Queued for ${parentBranch} (action: ${actionId}, holder: ${lock.holder}, queue size: ${lock.queue.length})`,
    );
  });
}

/**
 * Release the merge lock for a parent branch and wake the next queued entry.
 *
 * Idempotent: calling on an unheld lock is a no-op.
 */
export function releaseMergeLock(parentBranch: string): void {
  const lock = locks.get(parentBranch);
  if (!lock || lock.holder === null) return;

  const releasedAction = lock.holder;
  lock.holder = null;

  // Drain next entry
  if (lock.queue.length > 0) {
    const next = lock.queue.shift()!;

    // Clean up abort listener
    if (next.signal && next.abortHandler) {
      next.signal.removeEventListener("abort", next.abortHandler);
    }

    lock.holder = next.actionId;
    logger.debug(
      `[MERGE-QUEUE] Released ${parentBranch} (was: ${releasedAction}) → granted to ${next.actionId} (remaining queue: ${lock.queue.length})`,
    );
    next.resolve();
  } else {
    logger.debug(
      `[MERGE-QUEUE] Released ${parentBranch} (was: ${releasedAction}), no waiters`,
    );
    // Clean up empty lock
    locks.delete(parentBranch);
  }
}

/**
 * Get the current status of a merge queue for a branch.
 */
export function getMergeQueueStatus(parentBranch: string): {
  readonly holder: string | null;
  readonly queued: number;
} {
  const lock = locks.get(parentBranch);
  if (!lock) return { holder: null, queued: 0 };
  return { holder: lock.holder, queued: lock.queue.length };
}

/** Error thrown when a queued acquisition is cancelled via AbortSignal. */
export class MergeQueueAbortedError extends Error {
  readonly parentBranch: string;
  readonly actionId: string;

  constructor(parentBranch: string, actionId: string) {
    super(`Merge queue acquisition cancelled for ${parentBranch} (action: ${actionId})`);
    this.name = "MergeQueueAbortedError";
    this.parentBranch = parentBranch;
    this.actionId = actionId;
  }
}
