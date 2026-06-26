---
status: accepted
---

# Agent job → session-exit handoff goes through one seam

## Rule

In `packages/happy-agent`, a trigger that spawns a session and wants the
spawned process's exit to drive its AutomationScheduler job to a terminal state
calls `bindJobToSessionExit` (`src/daemon/bindJobToSessionExit.ts`) rather than
wiring `getTrackedSession(pid).childProcess.on("exit", …)` inline.

## Trigger

The webhook, supervisor, and task handlers (`daemon/triggerHandlers.ts`) and the
loop coordinator (`daemon/loopCoordinator.ts`) each repeated the same block four
times:

```ts
const tracked = (await import("./trackedSessions")).getTrackedSession(result.pid);
if (tracked?.childProcess) {
  tracked.childProcess.on("exit", (code) => {
    code === 0 ? scheduler.markCompleted(jobId) : scheduler.markFailed(jobId, `exit code ${code}`);
    ...per-trigger status notification...
  });
}
```

It passed the deletion test as pure duplication, and it carried a **silent
failure**: when `tracked?.childProcess` was absent, no listener was attached, the
job never reached a terminal state, and the scheduler's pump retried a "running"
job forever — with no single place to fix it.

## Decision

- `bindJobToSessionExit({ scheduler, jobId, pid, onExit? })` owns the constant
  core: resolve the tracked session, and on exit mark the job
  completed (code 0) or failed (`exit code <code>`).
- The per-trigger notification is the injected `onExit({ code, status })`
  callback — webhook/supervisor emit their status, the loop calls
  `onJobTerminal`, task passes nothing.
- The missing-tracked-session case is **no longer silent**: it logs a warning so
  a stuck job is visible. (A future change may escalate this to marking the job
  failed; left as a warning here to avoid reporting "failed" for a session that
  may actually be running.)
- `getTrackedSession` is injectable so the handoff is unit-testable;
  `bindJobToSessionExit.test.ts` pins exit-0 → completed, non-zero / null →
  failed, and the missing-session no-hang.

## Considered alternatives

- **Leave the four inline copies.** Rejected — the silent-hang bug had no single
  home, and a fifth trigger type would copy it again.
- **Fold the notification into the seam (branch on trigger kind inside).**
  Rejected — that pulls every trigger's client/coordinator dependency into the
  seam; the injected `onExit` keeps the seam dependency-free.

## Affected

`packages/happy-agent/src/daemon/bindJobToSessionExit.ts` (+ test),
`daemon/triggerHandlers.ts` (3 sites), `daemon/loopCoordinator.ts` (1 site).
