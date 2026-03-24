/**
 * Exponential backoff utility for retrying operations.
 *
 * Used primarily for OCC (optimistic concurrency control) retries
 * on metadata/state updates that may hit version conflicts.
 */

import { logger } from "../logger";

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    label?: string;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 200;
  const label = options?.label ?? "operation";

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelay * 2 ** attempt;
        logger.debug(`[backoff] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
