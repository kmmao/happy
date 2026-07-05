---
status: accepted
---

# The bounded LRU cache is extracted from EncryptionCache

## Context

`EncryptionCache` (App) holds five decrypted-data caches (agentState, metadata,
message, machineMetadata, daemonState). Each was a raw `Map<string,
CacheEntry<T>>` with its own hand-written get/set pair repeating the same LRU
mechanics: build the key, touch `accessTime` on read, `set` then call
`evictOldest`. The `evictOldest<T>` helper was already generic, but the rest of
the LRU behavior — touch-on-read, evict-on-write, and the prefix-delete used by
`clearMachineCache`/`clearSessionCache` — was spread across the five accessor
pairs and four inline `for … startsWith` loops, and was entirely untested (LRU
eviction and the null-value-vs-miss distinction had no coverage).

## Decision

`sync/encryption/lruCache.ts` provides a generic `LruCache<V>` owning the bounded
access-ordered semantics: `get` (touch + return, `undefined` = miss), `set`
(store + evict oldest past `maxSize`), `deletePrefix`, `clear`, `size`. The clock
is injectable (`now = Date.now` by default) so recency ordering is
deterministically testable. `EncryptionCache` now holds five `LruCache`
instances and its accessors shrink to key-building one-liners.

Two behaviors are preserved deliberately:
- **null-vs-miss**: daemon state may be cached as `null`; `LruCache.get`
  distinguishes a present entry (returns its `data`, possibly `null`) from a miss
  (`undefined`). `getCachedDaemonState` returns the raw result; the other
  accessors `?? null` to keep their prior `T | null` signature.
- **per-cache limits** (1000/1000/1000/500/500) move to each instance's
  constructor.

## Consequences

- The LRU mechanics have one home and a real test surface (`lruCache.test.ts`):
  round-trip, null-vs-miss, touch-reorders-eviction (via the injected clock),
  prefix-delete, and clear — none of which was tested when the logic lived inline.
- `EncryptionCache` drops to thin key-builders; adding a sixth cache is one
  `LruCache` field + two one-line accessors, not another get/set/evict copy.
- `evictOldest` and the `CacheEntry` shape are now private to `LruCache`; callers
  cannot depend on the internal map layout.
