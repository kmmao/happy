import { createHash } from "node:crypto";

const MAX_JITTER_MS = 15 * 60_000; // 15 minutes cap
const JITTER_FRACTION = 0.1; // 10% of interval

/**
 * Returns a deterministic jitter delay for a given task ID and interval.
 *
 * Properties:
 * - Same taskId always produces the same jitter (deterministic via SHA-256 hash)
 * - Different taskIds distribute uniformly across [0, min(interval*10%, 15min))
 * - Prevents thundering herd when many loops share similar schedules
 */
export function jitteredDelay(taskId: string, intervalMs: number): number {
  const hash = createHash("sha256").update(taskId).digest();
  const frac = hash.readUInt32BE(0) / 0x1_0000_0000;
  return Math.floor(Math.min(frac * intervalMs * JITTER_FRACTION, MAX_JITTER_MS));
}
