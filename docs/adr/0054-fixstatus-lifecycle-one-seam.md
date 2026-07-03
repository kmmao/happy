---
status: accepted
---

# The SupervisorAction fix lifecycle is owned by one pure seam

## Context

The fixStatus lifecycle (`null → pending → running → completed | failed |
analyzed`) was validated and transitioned in five files: the loop engine
(`supervisorLoopEngine.ts`), the machine-level watchdog
(`supervisorFixWatchdog.ts`), the action routes
(`supervisorActionRoutes.ts`), the socket report handler
(`supervisorFixStatusHandler.ts`), and auto-approval
(`supervisorAutoApproval.ts`). Each re-derived the same rules inline: which
statuses count as "active", what follows from a CLI fix-status report
(archive / kill / notify / loop progression), the auto-approve-and-queue-fix
write, the list-view filter mapping, and the watchdog's truly-stale rule.
`supervisorActionLogic.ts` already owned the *approval* state machine
(ADR-0047 confirmed the engine/autoLoop/scheduler split is intentional and is
NOT revisited here); the *fix* lifecycle had no owner.

## Decision

`sources/modules/supervisorFixStatusLogic.ts` is the single owner of the fix
lifecycle's pure decisions. Callers apply the decisions to Prisma / sockets /
push themselves; they must not re-derive the rules inline:

- **Vocabulary** — `ACTIVE_FIX_STATUSES` (moved here from
  `supervisorActionLogic`, which now imports nothing from it: the dependency
  is one-way, fix → approval, via `DISMISSED_APPROVALS`),
  `TERMINAL_FIX_STATUSES`, `isActive/isTerminalFixStatus`.
- **`decideFixStatusReport(reported, actionTitle)`** — everything that follows
  from a CLI report, consumed by BOTH report transports (socket handler and
  HTTP callback route) so they cannot drift silently: terminal-ness, archive,
  kill request, loop progression, push-notification content.
- **`decideAutoApproveAndQueueFix()`** — the approve-and-queue transition +
  CAS guard, shared by auto/semi-auto mode and the loop engine's iteration.
- **`canTriggerFix(current)`** — the POST /fix 409 guard.
- **`supervisorActionViewFilter(view)` / `isUpdatedAtOrderedView(view)`** —
  the list-view → query-filter mapping (including the fixing/analyzing
  `fixMode` split).
- **`selectTrulyStaleFixActions` / `STALE_FIX_RESOLUTION`** — the watchdog
  rule shared by the machine-level sweep and the loop engine's per-iteration
  watchdog.

## Flagged divergence (preserved, not resolved)

The two report transports disagree about `analyzed`: the socket handler
deliberately does **not** archive the analyze-first session (documented
intent: the user should be able to review the analysis), while the HTTP
callback requests a session **kill** on all terminal statuses *including*
`analyzed`. The seam preserves both behaviors verbatim
(`archiveSessionInDb` = completed|failed; `requestSessionKill` = all
terminal) and documents the divergence at the decision — unifying them is a
product decision, not a refactor. Whoever resolves it edits ONE field in ONE
place.

## Consequences

- A transition-rule change is one edit + one spec update; the five call sites
  pick it up by construction.
- The lifecycle is exhaustively unit-tested (`supervisorFixStatusLogic.spec.ts`)
  without driving Prisma or sockets.
- `ACTIVE_FIX_STATUSES` import sites moved from `supervisorActionLogic` to
  `supervisorFixStatusLogic`; `supervisorActionLogic` keeps only approval
  concepts.
