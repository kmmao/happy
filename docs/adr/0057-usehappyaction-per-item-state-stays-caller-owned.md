---
status: accepted
---

# useHappyAction per-item processing state stays caller-owned — no shared hook

## Context

An architecture review proposed a reusable `useHappyActionWithId` / `...Set`
hook to concentrate the "which item is currently processing" state that several
screens track alongside `useHappyAction`. The review estimated 26 call sites.
Verifying against the code shrank and split the claim:

- **The real footprint is three screens, in two INCOMPATIBLE patterns.**
  - `friends/index.tsx` — one shared `processingId: string | null` plus three
    `useHappyAction` actions (error-**Modal** semantics; the action bodies may
    throw and surface a modal). Single in-flight item at a time.
  - `settings/plugins.tsx` and `settings/mcp.tsx` — a `Set<string>` of in-flight
    ids, hand-tracked with `setActionInProgress(add)` / `finally remove` around
    **bare** async callbacks that report failures with `Modal.toast` + result
    objects, NOT `useHappyAction` and NOT error modals. Multiple concurrent
    in-flight items.
- **Unifying the two would change behavior.** A single hook that reuses
  `useHappyAction`'s error-modal path would force plugins/mcp from toast/result
  semantics into modals; a hook that keeps toast semantics would strip friends'
  modals. There is no shared invariant to concentrate — only a superficial
  "track an id while an async runs" shape.
- **The compatible pair (plugins + mcp) shares only React-state mechanics with
  no testable core.** The one thing they genuinely share — a `Set` plus a
  guaranteed `finally` cleanup — is ~3 lines of `useState` plumbing. This
  codebase does not unit-test hooks (no `renderHook` renderer is configured;
  the pattern is to extract PURE logic and test that). A `useInFlightIds` hook
  would be a thin, here-untestable wrapper, adopted only by invasive edits to
  two complex, untested settings screens.

By the deletion test, no complexity concentrates: deleting the (non-existent)
shared hook changes nothing, and the per-screen state is already local to each
screen where its error/toast semantics live.

## Decision

No shared `useHappyAction`-with-id hook. `useHappyAction` stays the thin
`[loading, doAction]` error-modal primitive; each screen keeps ownership of its
own in-flight tracking (single `processingId` for the modal pattern, a
hand-tracked `Set` for the toast pattern). A future review proposing to
"deduplicate per-item processing state around useHappyAction" should verify
against this ADR first.

## Consequences

- The friends modal pattern and the plugins/mcp toast+Set pattern stay
  independent; neither is forced into the other's error semantics.
- The trigger to revisit is a SECOND screen adopting the *same* error-modal +
  Set pattern (a real second adapter for one shape) — not the raw count of
  screens that happen to track a processing id.
