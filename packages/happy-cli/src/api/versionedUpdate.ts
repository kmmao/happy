import { backoff } from '@/utils/time'

/**
 * Normalized result of one optimistic-concurrency emit attempt. Each versioned
 * session blob (metadata, agentState, …) maps its own socket ack onto this.
 */
export type VersionedUpdateOutcome<T> =
  | { result: 'success'; version: number; value: T | null }
  | { result: 'version-mismatch'; version: number; value: T | null }
  | { result: 'error' }

export interface VersionedUpdateDriver<T> {
  /** Serializes updates to this blob — one in-flight update at a time. */
  lock: { inLock: (fn: () => Promise<void>) => void }
  /** Locally-known version at the moment of reading. */
  currentVersion: () => number
  /** One emit attempt at `expectedVersion`; returns the normalized outcome. */
  attempt: (expectedVersion: number) => Promise<VersionedUpdateOutcome<T>>
  /** Commit an accepted (version, value) pair to local state. */
  commit: (version: number, value: T | null) => void
}

/**
 * The optimistic-concurrency update loop shared by every versioned session blob.
 *
 * This owns the invariant so callers supply ONLY the type-specific emit + decode
 * (`attempt`) and the two-field write (`commit`):
 *   - runs inside `lock` so only one update to this blob is in flight
 *   - retries under `backoff` whenever the server reports version-mismatch
 *   - on success: commit the server-confirmed (version, value)
 *   - on version-mismatch: adopt the server's (version, value) ONLY if strictly
 *     newer than what we hold, then throw so backoff re-attempts at that version
 *   - on hard error: stop silently (no retry, no commit)
 *
 * Fire-and-forget, matching the prior inline callers: it queues on the lock and
 * returns immediately.
 */
export function runVersionedUpdate<T>(driver: VersionedUpdateDriver<T>): void {
  driver.lock.inLock(async () => {
    await backoff(async () => {
      const outcome = await driver.attempt(driver.currentVersion())
      if (outcome.result === 'success') {
        driver.commit(outcome.version, outcome.value)
        return
      }
      if (outcome.result === 'version-mismatch') {
        // Adopt the server's newer state so the next attempt is up to date.
        if (outcome.version > driver.currentVersion()) {
          driver.commit(outcome.version, outcome.value)
        }
        throw new Error('Version mismatch')
      }
      // hard error → give up
    })
  })
}
