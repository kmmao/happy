---
status: accepted
---

# The decrypt-then-validate cycle is owned by one codec seam

## Context

`SessionEncryption` (App) decrypts three per-session blobs — metadata, agentState,
and preferences — and each method re-implemented the same core cycle:
`decryptValue(...) → if null bail → schema.safeParse(...) → if !success bail →
use data`. The three differed only in the surrounding policy:

- **fallback**: metadata/preferences → `null`; agentState → `{}`.
- **caching**: metadata/agentState cache the result by `version`; preferences
  does not cache.
- **error mode**: preferences wraps in try/catch (soft failure); metadata and
  agentState let `decryptValue`'s decode/decrypt errors propagate.

The shared core carried a subtle invariant that a naive "return a fallback value"
helper would have broken: **only a genuine success may be cached**. Since
agentState's fallback (`{}`) is also a legitimate parsed value, a helper that
returned `{}` for both success-with-empty and failure would have let a decrypt
failure poison the cache (caching `{}` and never re-attempting).

## Decision

`sync/encryption/codec.ts` — already the home of the single-value codec — gains
`decryptAndParse<T>(decryptor, encrypted, schema)` returning a **discriminated
result** `{ ok: true; value: T } | { ok: false }`. `{ ok: false }` is the one
shape for all three failure modes (empty input, null decrypt, schema mismatch),
so the caller decides the fallback AND whether to cache — only an `ok` result is
cached. It uses the throwing `decryptValue` internally, so errors propagate
exactly as before; `decryptPreferences` keeps its own try/catch for soft failure.

Each caller shrinks to: check cache (where applicable) → `decryptAndParse` →
on `ok` cache + return value, else return the caller's fallback.

## Consequences

- The decrypt→validate cycle has one home and one test surface. `decryptAndParse`
  is unit-tested (`codec.test.ts`) with the existing fake JSON adapter + a Zod
  schema: success, schema-reject, empty-without-touching-adapter, null-decrypt,
  and error-propagation are pinned — no real crypto backend.
- The cache-only-on-success invariant is now explicit and unbreakable: callers
  branch on `result.ok`, so a failure can never be cached.
- The three fallbacks (`null` / `{}` / `null`) and the caching decisions stay
  visibly caller-owned — the seam does not try to unify policies that genuinely
  differ (matching the ADR-0028 principle of not widening an interface to the
  union of all callers).
- `decryptValue` is no longer imported directly by `sessionEncryption.ts`; the
  cycle lives behind the seam.
