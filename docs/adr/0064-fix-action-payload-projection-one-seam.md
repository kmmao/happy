---
status: accepted
---

# The SupervisorAction → fix-trigger payload projection is owned by one seam

## Context

Triggering a fix requires a small, fixed projection of a `SupervisorAction`
row onto the `fixAction` payload the CLI daemon receives:
`{ title, description, suggestedFix, category, severity }`, plus an optional
`issueNumber` that is NOT part of the row (it comes from a provider-created
tracking issue). That projection was hand-written inline at four call sites:

- `supervisorRoutes.ts` (reprocess/approve → fix),
- `supervisorActionRoutes.ts` (manual POST /fix),
- `supervisorAutoApproval.ts` (auto/semi-auto approval loop — the one site that
  also attaches `issueNumber`),
- `supervisorLoopEngine.ts` (autopilot iteration — which emits the
  `supervisor-trigger` ephemeral directly rather than via
  `emitConfiguredSupervisorFixTrigger`).

The target type `SupervisorFixActionTriggerInput` already existed in
`supervisorFixTrigger.ts`, but it was a private `interface` and each caller
re-typed the object literal by hand. Nothing enforced that all four projected the
same fields: a fifth field added to the payload (or a rename of `suggestedFix`)
would silently reach only the sites someone remembered to edit, and a stray field
spread from a full row could leak. The projection is invariant-bearing — "which
SupervisorAction fields cross to the CLI, and which do not" — yet it had no owner.

## Decision

`supervisorFixTrigger.ts` exports `buildFixActionTriggerInput(action, issueNumber?)`
as the single owner of the projection, alongside the now-exported
`SupervisorFixActionTriggerInput` type. All four call sites pass the row (and, at
the auto-approval site, the separately-sourced `issueNumber`) and take the result.
The builder explicitly picks the five fields — so extra row fields cannot leak —
and OMITS `issueNumber` entirely when not supplied (rather than emitting
`issueNumber: undefined`), matching the prior wire shape.

This is the payload-projection analogue of the seams established for the fix
lifecycle (ADR-0054) and the config blob (ADR-0059): the mapping rule lives in one
module; callers apply it. It intentionally covers the engine site too, even though
that site emits the ephemeral directly — the projection is the shared thing, not
the emit path.

## Consequences

- A change to the fix payload's field set is one edit in the builder + one spec
  update; the four call sites pick it up by construction, and a full-row field can
  no longer leak into the wire.
- The projection has a single test surface (`supervisorFixTrigger.spec.ts`),
  including the `issueNumber`-omitted-not-undefined invariant, without driving
  sockets or auth.
- A new inline `fixAction: { title: action.title, ... }` literal at a fifth call
  site is the smell that this seam is being bypassed.
