---
status: accepted
amended-by: 0068
---

> **Amended by ADR-0068**: the latest-request-wins *guard* was later extracted
> into `useLatestRequest` once a fourth adapter appeared (the trigger this ADR
> named). The core ruling below — do NOT merge the data hooks themselves — still
> stands; only the "one adapter, don't extract the guard" premise is superseded.

# The knowledge / inbox data hooks deliberately do NOT share a fetch/dedup seam

## Context

A recurring architecture-review suggestion is to "DRY up the data hooks":
`useSessionKnowledge`, `useProjectKnowledge`, and `useInboxData` all fetch from
the server and hold list state, so surely the async-fetch + stale-result dedup
could be one shared hook (`useLatestRequestFetch` or similar).

On inspection the premise does not hold — the three hooks use three genuinely
different async shapes:

- **`useSessionKnowledge`** is the ONLY one with a "latest-request-wins"
  invariant. Its inputs (`projectServerId`, `sessionId`) change as the user
  navigates, so an in-flight fetch for the previous session must not overwrite
  state for the current one. It carries `mountedRef` + `latestRequestTokenRef` +
  `latestStateKeyRef`, bumps the token on every input change and every refresh,
  and gates each `setState` on `requestToken === latestRequestToken`. Those two
  guard rules are ALREADY extracted into pure predicates in
  `sessionKnowledgeState.ts` (`shouldResetSessionKnowledgeState`,
  `shouldApplyKnowledgeRequestResult`) — the seam that was worth having exists.

- **`useProjectKnowledge`** has no stale-request guard at all. It is keyed to a
  single project for its lifetime, tracks `lastRefreshAtRef` / `totalRef`
  (timestamps + pagination totals), and its writes are wholesale
  `setEntries(...)`. Its complexity is pagination (`loadMore`, `hasMore`) and
  multi-list state (active / archived / superseded / profile), not request
  racing.

- **`useInboxData`** has no stale-request guard either. It uses functional
  `setState((prev) => ...)`, is driven as much by socket ephemerals
  (`onInboxNewItem`, `onInboxUnreadCount`) and optimistic mutations
  (markRead / delete / clearAll) as by the initial fetch, and never re-keys.

## Decision

Do not extract a shared fetch/dedup hook across these three. The
latest-request-wins invariant has exactly ONE adapter (`useSessionKnowledge`),
and its reusable part (the two predicates) is already a seam. Per the project's
architecture language, **one adapter is a hypothetical seam, not a real one** —
introducing a shared hook here would be premature abstraction: it would have to
grow options for "guard vs no-guard", "re-keyed vs lifetime-keyed",
"socket-driven vs not", "paginated vs not", making the shared interface as
complex as the three call sites it replaced (a shallow module).

If a SECOND hook ever needs the same re-key + latest-request-wins behavior,
that is the trigger to lift the choreography (not just the predicates) out of
`useSessionKnowledge` into a shared hook — two adapters make the seam real.

## Consequences

- The three hooks stay independent; each owns the async shape its screen needs.
- `sessionKnowledgeState.ts` remains the extracted-predicate seam for the one
  hook that has the invariant — that is the correct amount of sharing today.
- A future review proposing "unify the data hooks" should read this first: the
  surface similarity (they all fetch) is not a shared invariant.
