---
status: accepted
---

# The supervisor decision flow's split across engine / autoLoop / scheduler is intentional

## Context

An architecture review flagged the supervisor decision flow as fragmented:
"no single place owns the loop iteration state machine — the decision is split
between `supervisorLoopEngine`, `supervisorAutoLoop`, `supervisorScheduler`, and
the routes, and the approval threshold is checked in two places." This ADR
records why that split is deliberate, so future reviews don't re-suggest
collapsing it (which would re-litigate ADR-0022, landed with 105 server tests).

## Findings (the friction is largely not real)

- **Exit conditions are already centralized.** `checkExitConditions` is one pure
  function in `supervisorLoopEngine.ts`, called only from within that engine
  (`onRunCompleted`, `onFixCompleted`, and the iteration paths). It is NOT
  re-checked in routes. It is already a deep, single-owner policy.

- **Approval has a clear owner per path, not a duplicate.** Auto-approval runs in
  exactly one of two mutually-exclusive paths, guarded explicitly:
  `supervisorRunStatusApply.ts` auto-approves a **non-loop** run
  (`if (!runForAutoApprove?.loopId && actionsCount > 0) handleAutoApproval(...)`,
  with the comment "Skip if run belongs to a loop — Loop engine handles its own
  approval flow"); a **loop** run's actions are approved by the engine's
  iteration query (`confidence: { gte: loop.autoApproveThreshold }`). The
  `loopId` guard makes double-approval impossible. `autoApproveThreshold` is
  shared *config*, not duplicated *logic*.

- **engine / autoLoop / scheduler are distinct responsibilities, not one
  fragmented machine.** The engine owns "given a completed run/fix, iterate or
  exit?"; `supervisorAutoLoop` owns "should an auto-loop fire at all?"
  (threshold/debounce/already-active); the scheduler owns "is a cron run due?".
  These are three different questions with three different inputs — separate
  seams, deliberately.

## Decision

Leave the structure as-is. Do not merge the three modules into a single
"supervisor state machine," and do not unify the two approval paths. The
apparent split is the intended shape per ADR-0022 (SupervisorLoop fully absorbed
into AgentLoop, contract pinned by tests).

## Re-evaluate when

- A real bug is traced to the two approval paths disagreeing (today the `loopId`
  guard prevents overlap) — then revisit whether they should share more than the
  `autoApproveThreshold` config.
- `checkExitConditions` callers start appearing outside `supervisorLoopEngine`
  (it would mean the exit policy is leaking out of its owner).

## Affected

No code change. Documents `supervisorLoopEngine.ts`,
`supervisorAutoLoop.ts`, `supervisorScheduler.ts`, and
`app/api/supervisor/supervisorRunStatusApply.ts`. Relates to ADR-0022.
