---
status: accepted
---

# Scoring-credential resolution single-sources the zero-variance pieces; the fallback policy stays caller-owned

## Context

Four LLM-scoring routes resolve **ScoringCredentials** from a request the same
way: `POST /v1/options/score`, `POST /v1/options/generate`,
`POST /v1/agent-loops/suggest`, and the supervisor dimension route each carried a
private `resolveCredentials(accountId, profileId)` + `fallbackFromServerEnv()`
pair. Read side by side, two pieces were duplicated with **no variance**:

- The profile lookup — `SELECT "profileKey", "encryptedPayload" FROM
  "AiBackendProfile" WHERE "profileKey" = … AND "accountId" = … AND
  "archivedAt" IS NULL LIMIT 1` → `decryptAiBackendProfile(…)` — appeared
  verbatim in all four routes, and again (with a richer return) in
  `supervisorProfileResolver.ts`.
- `fallbackFromServerEnv()` — building a five-key env object from `process.env`
  and calling `detectProviderFromEnv` — was **byte-for-byte identical** across
  the four routes.

A new provider env var added to only some copies, or a drift in the
`archivedAt IS NULL` guard, would silently diverge. None of the duplication was
caught by a test (`detectProviderFromEnv` had unit coverage; the route-local
copies did not).

The routes do **not** behave identically, though. When a bound profile resolves
to no usable provider, `options/score` and `options/generate` fall back to the
server env (`detectProviderFromEnv(env) ?? fallback`), while
`agent-loops/suggest` and the supervisor dimension route return the profile's
provider strictly (no fallback). That is genuine caller-owned policy.

## Decision

**Extract only the two zero-variance pieces** into
`modules/scoringCredentials.ts`:

- `loadDecryptedProfile(accountId, profileId)` — the profile lookup + decrypt,
  returning `AIBackendProfile | null` (null when no live row exists).
- `serverEnvScoringCredentials()` — the byte-for-byte server-env fallback.

The four routes and `supervisorProfileResolver.ts` call these; each keeps its
own **fallback-on-empty policy** and no-row handling inline. `supervisorProfile-
Resolver` keeps its built-in-profile branch and not-found throw — it needs the
decrypted `profile` object (for `createResolvedRuntimeProfile` + `profile.name`),
which `loadDecryptedProfile` returns, so only its duplicated lookup is removed.

`serverEnvScoringCredentials` is pinned by `scoringCredentials.spec.ts` (the
env-name → provider mapping that was duplicated four ways).

## Considered options

- *Extract one `resolveScoringCredentials(accountId, profileId, { fallbackOnEmpty })`.*
  Rejected: the only variance across the four routes is the single
  fallback-on-empty boolean, so the unified function would carry a flag for that
  variance — the shallow-seam shape ADR-0036 warns against. Keeping the tiny
  per-route wrapper leaves the policy visible at the call site.
- *Leave all five copies inline.* Rejected: the lookup SQL and the server-env
  fallback are wire/data invariants with zero variance; a field added in one
  place would drift from the others, exactly the failure ADR-0034/0037/0038
  guard against elsewhere.

## Consequences

- The profile-lookup SQL and the server-env fallback now have one home each; a
  change to the archived filter or a new provider env var is a one-line edit.
- The per-route fallback policy stays caller-owned and visible — a future review
  proposing to "unify the four `resolveCredentials`" should read this first: the
  remaining per-route wrappers reflect deliberate policy variance, not
  duplication.
- This is the same "single-source the zero-variance body, keep the policy at the
  call site" move as ADR-0036's `profileUnavailableBody`.
