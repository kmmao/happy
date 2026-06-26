---
status: accepted
---

# AgentLoopCoordinator deepens by extracting pure policy seams

## Context

`packages/happy-cli/src/automation/AgentLoopCoordinator.ts` (~1.27k lines) is the
runtime for AgentLoops — create/update, schedule, event intake, and the
iteration lifecycle. It accumulated several pure decision functions inline:
auto-run gating, event matching, and the terminal-outcome computation. Each
carried bug-prone rules (timezone/midnight-wrap, daily-quota/budget resets,
transient-vs-permanent failure classification, backoff floors, guardian
self-heal) but had no test surface — they could only be exercised by driving the
whole coordinator with a mocked clock.

## Decision

Deepen `AgentLoopCoordinator` the same way `startDaemon` is deepened
(ADR-0046): lift each self-contained **policy** into its own pure
`(...inputs) => decision` module with direct tests, leaving the coordinator as
the effect-applying runner. Three policies are now extracted:

- `agentLoopAutoRunPolicy.ts` — `evaluateAutoRunPolicy(loop, now)` plus
  `isWithinQuietHours`, the day-boundary counter resets (`normalizeAutoRunCounter`
  / `normalizeDailyCostCounter`, `localDayStartAt`), and `canAutoRun`.
- `agentLoopEventMatch.ts` — `evaluateLoopEventFilters(loop, event)` (source
  allowlist + keyword filters).
- `agentLoopTerminalOutcome.ts` — `computeAgentLoopTerminalOutcome(existing,
  params, now)` (failure classification, backoff/rate-limit deferral, daily-cost
  rollup, stop-reason precedence, guardian self-heal threshold). `onJobTerminal`
  now calls this and applies the returned outcome as effects.

All three moved verbatim — no behavior change. The 24-test
`AgentLoopCoordinator.test.ts` (incl. the transient-error-budget case that runs
through `onJobTerminal`) still passes, and each policy gains its own focused
suite.

## Considered alternatives

- **One sweeping rewrite of the coordinator.** Rejected — same reasoning as
  ADR-0046: highest blast radius on the automation runtime, not reviewable in
  small steps. Staged policy extraction reaches the same end state with each step
  verified.
- **Leave the policies inline.** Rejected — the bug-prone rules (quiet-hours
  wrap, daily resets, transient classification, backoff math) had no direct test
  surface, which is exactly where they are hardest to reach by driving the whole
  coordinator.

## Re-evaluate when

Future architecture reviews should propose the *next policy to extract* from the
coordinator (e.g. the cron `next-run-at` math, downstream-cascade selection),
not a wholesale rewrite.

## Affected

`packages/happy-cli/src/automation/agentLoopAutoRunPolicy.ts`,
`agentLoopEventMatch.ts`, `agentLoopTerminalOutcome.ts` (+ their tests), and
`AgentLoopCoordinator.ts` (now imports them). Relates to ADR-0046.
