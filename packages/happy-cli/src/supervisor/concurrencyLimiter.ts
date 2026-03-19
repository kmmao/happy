/**
 * Machine-level concurrency limiter for supervisor sessions.
 *
 * Two independent pools:
 * - "analysis" pool: shared by analysis + research sessions (default max: 3)
 * - "fix" pool: for fix worktree sessions (default max: 2)
 *
 * When a pool is full, callers queue and wait (no timeout).
 * Queued entries can be cancelled via AbortSignal.
 */

import { logger } from "@/ui/logger";

export type SlotType = "analysis" | "fix";

interface QueueEntry {
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly abortHandler: (() => void) | null;
  readonly signal?: AbortSignal;
}

interface Pool {
  active: number;
  max: number;
  readonly queue: QueueEntry[];
}

const pools: Record<SlotType, Pool> = {
  analysis: { active: 0, max: 3, queue: [] },
  fix: { active: 0, max: 2, queue: [] },
};

/**
 * Update the maximum concurrency for a pool.
 * Does NOT retroactively kill running sessions — only affects future acquisitions.
 */
export function setMaxConcurrency(type: SlotType, max: number): void {
  const clamped = Math.max(1, Math.min(max, 10));
  pools[type].max = clamped;
  logger.debug(
    `[CONCURRENCY] Set ${type} max to ${clamped}`,
  );
  // Drain queue if new max allows more slots
  drainQueue(type);
}

/**
 * Acquire a slot, waiting in queue if the pool is full.
 *
 * @param type - Pool type ("analysis" for analysis/research, "fix" for fix sessions)
 * @param signal - Optional AbortSignal to cancel while queued
 * @returns Promise that resolves when a slot is acquired
 * @throws If the signal is aborted while waiting
 */
export function acquireSlot(
  type: SlotType,
  signal?: AbortSignal,
): Promise<void> {
  const pool = pools[type];

  // Fast path: slot available immediately
  if (pool.active < pool.max) {
    pool.active++;
    logger.debug(
      `[CONCURRENCY] Acquired ${type} slot (${pool.active}/${pool.max})`,
    );
    return Promise.resolve();
  }

  // Already aborted
  if (signal?.aborted) {
    return Promise.reject(new ConcurrencyAbortedError(type));
  }

  // Queue and wait
  return new Promise<void>((resolve, reject) => {
    const entry: QueueEntry = {
      resolve,
      reject,
      abortHandler: signal
        ? () => {
            // Remove from queue
            const idx = pool.queue.indexOf(entry);
            if (idx !== -1) {
              pool.queue.splice(idx, 1);
            }
            reject(new ConcurrencyAbortedError(type));
          }
        : null,
      signal,
    };

    if (signal && entry.abortHandler) {
      signal.addEventListener("abort", entry.abortHandler, { once: true });
    }

    pool.queue.push(entry);
    logger.debug(
      `[CONCURRENCY] Queued ${type} (queue size: ${pool.queue.length}, active: ${pool.active}/${pool.max})`,
    );
  });
}

/**
 * Release a slot back to the pool and wake the next queued entry.
 */
export function releaseSlot(type: SlotType): void {
  const pool = pools[type];
  if (pool.active > 0) {
    pool.active--;
    logger.debug(
      `[CONCURRENCY] Released ${type} slot (${pool.active}/${pool.max})`,
    );
    drainQueue(type);
  }
}

/**
 * Get the current status of a pool.
 */
export function getPoolStatus(type: SlotType): {
  readonly active: number;
  readonly max: number;
  readonly queued: number;
} {
  const pool = pools[type];
  return {
    active: pool.active,
    max: pool.max,
    queued: pool.queue.length,
  };
}

/**
 * Check if there is an available slot without acquiring it.
 */
export function hasAvailableSlot(type: SlotType): boolean {
  return pools[type].active < pools[type].max;
}

/** Drain queued entries into available slots. */
function drainQueue(type: SlotType): void {
  const pool = pools[type];
  while (pool.active < pool.max && pool.queue.length > 0) {
    const entry = pool.queue.shift()!;

    // Clean up abort listener
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }

    pool.active++;
    logger.debug(
      `[CONCURRENCY] Dequeued ${type} (${pool.active}/${pool.max}, remaining queue: ${pool.queue.length})`,
    );
    entry.resolve();
  }
}

/** Error thrown when a queued acquisition is cancelled. */
export class ConcurrencyAbortedError extends Error {
  readonly slotType: SlotType;

  constructor(type: SlotType) {
    super(`Concurrency slot acquisition cancelled for ${type}`);
    this.name = "ConcurrencyAbortedError";
    this.slotType = type;
  }
}
