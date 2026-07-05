---
status: accepted
amends: 0062
---

# The latest-request-wins guard is extracted (amends ADR-0062)

## Context

ADR-0062 declined to unify the knowledge/inbox data hooks, on the grounds that
the "latest request wins" stale-response guard had **one** real adapter
(`useSessionKnowledge`) and its reusable predicate
(`shouldApplyKnowledgeRequestResult`) was already extracted. It recorded an
explicit reopening trigger:

> If a SECOND hook ever needs the same re-key + latest-request-wins behavior,
> that is the trigger to lift the choreography out into a shared hook — two
> adapters make the seam real.

A follow-up survey found that trigger has decisively fired. The identical guard —
stamp each request with a monotonic token, discard a response whose token is no
longer the latest, bump the token to invalidate in-flight requests — was
re-implemented in **four** hooks:

- `useSessionKnowledge` (via `shouldApplyKnowledgeRequestResult`),
- `useSessionKnowledgeAccesses` (same predicate),
- `useKnowledgeSearch` (its own inline `requestIdRef` variant),
- `useProjectScopedAsyncData` (its own inline `requestToken !== latest` variant).

## Decision

Extract ONLY the guard, not the hooks. `hooks/useLatestRequest.ts` owns it as a
pure `createRequestGuard()` (a monotonic counter behind a
`begin()`/`isCurrent(token)`/`invalidate()` interface) plus a `useLatestRequest()`
hook that returns one stable guard for the component's lifetime. All four hooks
call the guard; `shouldApplyKnowledgeRequestResult` is deleted (subsumed by
`isCurrent`).

**ADR-0062's core conclusion still stands**: the hooks are NOT merged. Their
surrounding choreography genuinely differs — re-key triggers
(`(projectServerId, sessionId)` change vs project change vs debounced query vs
none), pagination, 300ms debounce, optimistic mutations, socket subscriptions —
and folding those together would recreate the shallow union ADR-0062 rejected.
Only the one invariant that is now provably shared (4 adapters) moved.

## Consequences

- The stale-response guard has one home and one test surface
  (`useLatestRequest.test.ts`, testing `createRequestGuard` without a renderer):
  current-after-begin, supersede-older, invalidate-discards, monotonicity. The
  old predicate's two test files are consolidated here (`sessionKnowledgeRace.test.ts`
  deleted; `sessionKnowledgeState.test.ts` keeps only the reset-predicate tests).
- A fifth hook with the same race gets `useLatestRequest()` instead of a fifth
  inline copy.
- This is a scoped amendment: the "don't merge the data hooks" ruling of ADR-0062
  is unchanged; only its "one adapter, don't extract the guard" premise is
  superseded by the observed fourth adapter.
