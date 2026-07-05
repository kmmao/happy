import { describe, it, expect } from 'vitest'
import { runVersionedUpdate, type VersionedUpdateOutcome } from './versionedUpdate'

/** A lock fake that runs the critical section immediately and exposes its promise. */
function immediateLock() {
  let pending: Promise<void> = Promise.resolve()
  return {
    lock: { inLock: (fn: () => Promise<void>) => { pending = fn() } },
    settled: () => pending,
  }
}

type Val = { v: number }

/**
 * Drive runVersionedUpdate with a scripted sequence of attempt outcomes and a
 * version holder that commit() advances — mirroring how the real caller stores
 * `this.metadataVersion` / `this.metadata`.
 */
function harness(script: VersionedUpdateOutcome<Val>[], startVersion = 0) {
  const { lock, settled } = immediateLock()
  const expectedVersions: number[] = []
  const committed: Array<{ version: number; value: Val | null }> = []
  let version = startVersion
  let value: Val | null = null
  let i = 0

  runVersionedUpdate<Val>({
    lock,
    currentVersion: () => version,
    attempt: async (expectedVersion) => {
      expectedVersions.push(expectedVersion)
      return script[Math.min(i++, script.length - 1)]
    },
    commit: (v, val) => {
      version = v
      value = val
      committed.push({ version: v, value: val })
    },
  })

  return { settled, expectedVersions, committed, get version() { return version }, get value() { return value } }
}

describe('runVersionedUpdate', () => {
  it('commits once on immediate success and does not retry', async () => {
    const h = harness([{ result: 'success', version: 5, value: { v: 1 } }])
    await h.settled()
    expect(h.committed).toEqual([{ version: 5, value: { v: 1 } }])
    expect(h.expectedVersions).toEqual([0])
    expect(h.version).toBe(5)
  })

  it('adopts a newer server version on mismatch, then retries at that version until success', async () => {
    const h = harness(
      [
        { result: 'version-mismatch', version: 9, value: { v: 9 } },
        { result: 'success', version: 10, value: { v: 10 } },
      ],
      2,
    )
    await h.settled()
    // first attempt used the stale version, retry used the adopted one
    expect(h.expectedVersions).toEqual([2, 9])
    // committed twice: the adopt-newer, then the success
    expect(h.committed).toEqual([
      { version: 9, value: { v: 9 } },
      { version: 10, value: { v: 10 } },
    ])
    expect(h.version).toBe(10)
  })

  it('does NOT commit a mismatch whose version is not strictly newer, but still retries', async () => {
    const h = harness(
      [
        { result: 'version-mismatch', version: 3, value: { v: 3 } }, // 3 <= 5 → ignore
        { result: 'success', version: 6, value: { v: 6 } },
      ],
      5,
    )
    await h.settled()
    // the stale mismatch did not commit; only the success did
    expect(h.committed).toEqual([{ version: 6, value: { v: 6 } }])
    expect(h.expectedVersions).toEqual([5, 5]) // version unchanged between attempts
  })

  it('stops silently on hard error — no commit, no retry', async () => {
    const h = harness([{ result: 'error' }, { result: 'success', version: 99, value: { v: 99 } }])
    await h.settled()
    expect(h.committed).toEqual([])
    expect(h.expectedVersions).toEqual([0]) // only one attempt — no retry
    expect(h.version).toBe(0)
  })
})
