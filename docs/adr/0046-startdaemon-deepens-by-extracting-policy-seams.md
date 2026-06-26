---
status: accepted
---

# startDaemon deepens by extracting policy seams, not a big-bang rewrite

## Context

`packages/happy-cli/src/daemon/startDaemon.ts` is ~3.1k lines: the daemon's
composition root wiring auth, persistent registries, the control server, the
scheduler, session spawn/termination, and periodic watchdogs. Its init ordering
is largely implicit in statement order and closure capture, which is real
friction (ADR review keeps surfacing it). It is also the single most critical
CLI path — a wrong edit orphans processes or fails to start the daemon.

## Decision

Deepen `startDaemon` **incrementally**, by lifting one self-contained *policy*
at a time into a testable `(deps) => result` seam, leaving a thin delegator
behind. Do NOT attempt a single sweeping "composition root" rewrite of the
file.

The pattern is already established: `daemonProcessTree` (`createProcessTreeKiller`),
`startDaemonSessionRecovery`, and `startDaemonSessionWebhook`
(`onSessionHeartbeat`, `onHappySessionWebhook`, `onSessionFault`) were each
extracted this way. This ADR makes the approach explicit and adds
`daemonAutomationWatchdog` (the automation watchdog policy + runner) as the next
extraction.

Each extraction separates the **decision** (pure, deterministic in `now`/inputs
— the bug habitat) from the **effects** (kill, forget, persist). The decision
becomes the test surface; the runner is thin wiring; the `startDaemon` closure
shrinks to a delegator that injects the in-scope dependencies.

## Considered alternatives

- **One composition-root refactor of the whole file.** Rejected — highest blast
  radius on the daemon hot path, not reviewable in small steps, and the ordering
  invariants are subtle enough that a staged extraction (each verified by its own
  unit tests) is the safer route to the same end state.
- **Leave the watchdog inline.** Rejected — its threshold/exemption policy
  (runtime vs inactivity, recovered-from-index exemption, supervisor-`fix`
  exemption) was untestable without standing up the whole daemon, and it was the
  last fat policy closure whose siblings had already been extracted.

## Consequences

- `daemonAutomationWatchdog.test.ts` pins the watchdog policy directly (12 cases)
  — behavior that previously had no test surface.
- The broader init-ordering friction in `startDaemon` remains and is addressed by
  continuing this pattern, not by re-suggesting a big-bang rewrite. Future
  architecture reviews should propose the *next seam to extract*, not the rewrite.

## Affected

`packages/happy-cli/src/daemon/daemonAutomationWatchdog.ts` (new seam + tests),
`packages/happy-cli/src/daemon/startDaemon.ts` (inline watchdog → delegator).
Prior extractions: `daemonProcessTree.ts`, `startDaemonSessionRecovery.ts`,
`startDaemonSessionWebhook.ts`.
