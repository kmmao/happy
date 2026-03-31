# Automation Loop Platform Plan

_Last updated: 2026-04-01_  
_Scope: current implementation status, reference baseline, handoff map, and remaining backlog for Happy's automation/autonomy loop platform._

## Overview
This document is the current handoff plan for Happy's automation platform.

It started as a forward-looking architecture plan, but the core platform work is now largely implemented. The document's primary purpose is no longer to describe a hypothetical rollout. It now serves as:
- the current status snapshot of Happy automation
- the operator/developer map for where the automation surfaces live
- the handoff guide for the next person continuing the work
- the prioritized backlog for optional follow-up improvements

In practical terms, Happy now has a real automation control plane covering daemon scheduling, supervisor/webhook job execution, guardian continuity, audit visibility, machine UI controls, and project-side autonomous loop visibility.

## Current Implementation Status

### Completed platform capabilities
- [x] `ExecutionGuard` and remote execution state scaffolding are live.
- [x] Durable daemon-side automation storage/scheduling exists for supervisor and webhook triggers.
- [x] Recovery exists for non-terminal queued/dispatching jobs using local store replay.
- [x] Session-level queue metadata exists in `MessageQueue2` with urgent/user/background routing.
- [x] Session-backed automation jobs remain `running` until session exit or a terminal callback finalizes them.
- [x] Supervisor runs carry project/loop metadata through the automation job pipeline.
- [x] Scheduled supervisor runs use cadence-aware catch-up and atomic claim semantics.
- [x] Guardian continuity exists for supervisor automation and can be reused/reset.
- [x] Watchdog/session stop activity is recorded into automation audit events.
- [x] Automation audit logs are persisted daemon-locally and exposed through RPC/CLI/UI.
- [x] Guardian usage statistics and audit statistics are derived from persisted audit events.
- [x] Machine-side automation controls support retry, cancel, stop, clear terminal jobs, clear guardians, and clear audit history.
- [x] Machine automation UI includes summary, detail, timeline, audit, guardian usage, and search/filter drill-downs.
- [x] Machine automation UI surfaces guardian `attached` vs `persisted` state and anomaly alerts.
- [x] Supervisor autonomous loops have dedicated CLI/server/app visibility for summary/config/start/status/history/detail/pause/resume/stop.
- [x] Regression coverage exists for audit derivation, audit persistence, guardian continuity, and automation status shape.

### What is no longer a gap
The following are already considered closed for the current milestone:
- basic daemon-side automation orchestration
- durable automation jobs for supervisor/webhook work
- guardian continuity persistence and reset controls
- audit/stat visibility for machine-local autonomy behavior
- machine-side inspection and operator controls
- project-side visibility into autonomous loop state and scheduling state

## What Exists Today

## Reference Baseline and Design Alignment
The implementation direction here was informed by a targeted review of the production-validated automation flow in `/Users/sangreal/Documents/GitHub/claude-code`, especially:
- `README.md` for the broader tool/command/runtime shape
- `src/skills/bundled/loop.ts` for the recurring loop interaction model

The most relevant patterns from that reference are:
- recurring work should be represented as a durable scheduled primitive rather than ad hoc prompts
- the operator should get explicit visibility into cadence, retention, and cancellation controls
- useful loops should execute immediately once, not only on the next scheduled tick
- automation should be observable and operationally inspectable rather than hidden behind agent magic

Happy already reflects those lessons, but at a different layer:
- Happy uses the daemon automation scheduler plus supervisor/webhook orchestration as the durable runtime
- Happy exposes machine/project visibility, guardian continuity, and audit surfaces instead of only a slash-command wrapper
- Happy keeps autonomous behavior tied to project/supervisor workflows rather than introducing a generic prompt-loop primitive first

What Happy intentionally does **not** do yet:
- it does not clone Claude Code's broad monolithic agent runtime or tool ecosystem
- it does not expose a generic `/loop`-style prompt scheduler as the main product surface
- it does not attempt unsafe automatic guardian reattachment after daemon restart

### Daemon automation control plane
Primary runtime responsibilities are already implemented:
- enqueue supervisor/webhook automation work
- persist jobs locally
- requeue unfinished work after daemon restart
- keep session-backed jobs running until the underlying session exits
- track guardian continuity for supervisor analysis/research flows
- persist automation audit events and derive guardian/audit statistics

Primary code locations:
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/automation/AutomationScheduler.ts`
- `packages/happy-cli/src/automation/AutomationStore.ts`
- `packages/happy-cli/src/automation/GuardianSessionRegistry.ts`
- `packages/happy-cli/src/automation/AutomationAudit.ts`
- `packages/happy-cli/src/automation/AutomationAuditStore.ts`

### CLI operator surface
Automation management is exposed through `happy daemon automation`.

Current commands:
- `happy daemon automation list`
- `happy daemon automation timeline`
- `happy daemon automation guardians`
- `happy daemon automation guardians clear <key>`
- `happy daemon automation guardians clear --all`
- `happy daemon automation stats`
- `happy daemon automation audit`
- `happy daemon automation audit clear`
- `happy daemon automation stop <jobId>`
- `happy daemon automation retry <jobId>`
- `happy daemon automation cancel <jobId>`
- `happy daemon automation clear`

Current filtering support:
- `list` / `timeline`: `--running`, `--failed`, `--terminal`, `--project <id>`, `--loop <id>`, `--kind <kind>`
- `guardians`: `--attached`, `--persisted`, `--project <id>`, `--loop <id>`
- `audit`: `--anomalies`, `--guardian`, `--jobs`, `--project <id>`, `--loop <id>`
- `stats`: `--project <id>`, `--loop <id>`

Primary code locations:
- `packages/happy-cli/src/index.ts`
- `packages/happy-cli/src/daemon/controlClient.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`
- `packages/happy-cli/src/api/apiMachine.ts`

### Machine UI surface
There are now two main machine-facing views.

#### 1. Machine summary card
This is the lightweight operator summary shown on the machine detail page.

It currently shows:
- queued/running/failed/completed/cancelled counts
- guardian count
- guardian reuse rate
- watchdog stop count
- recent guardian preview
- anomaly / guardian recovery indicators
- quick navigation to the full automation detail page

Primary code location:
- `packages/happy-app/sources/components/machine/AutomationSummarySection.tsx`

#### 2. Machine automation detail page
This is the main machine automation inspection surface.

It currently includes:
- aggregate automation counts
- guardian list with attached/persisted state
- audit statistics
- guardian usage list
- automation audit log
- derived lifecycle timeline
- full job list
- search/filter drill-downs
- job / guardian / audit-event modal detail drill-downs
- operator actions for retry/cancel/stop/clear/reset

Primary code location:
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`

### Project UI surface
Project-side autonomy visibility is already present.

Current project UI signals include:
- active loop presence and current phase
- schedule enabled/disabled status
- next run time
- overdue schedule warning
- loop history shortcuts
- navigation into active loop/settings

Primary code locations:
- `packages/happy-app/sources/components/project/ProjectHealthTab.tsx`
- `packages/happy-app/sources/components/project/SupervisorSummaryCard.tsx`

## Current State of Recovery and Guardian Continuity

### What works now
- Guardian continuity is persisted locally via `guardian-sessions.json`.
- Guardians can be reused, cleared individually, or cleared globally.
- The machine/CLI surfaces now distinguish guardian entries that are currently `attached` to a daemon-tracked live session from entries that are only `persisted` continuity state.
- This is enough to answer an important operational question: whether a guardian is actively reconnectable inside the current daemon lifecycle or is only historical continuity metadata.

### What does not yet exist
The daemon does **not** yet have a fully reliable session-reattachment mechanism that can, after a daemon restart, rediscover and re-bind all previously live guardian sessions purely from durable local state.

That is the main remaining advanced recovery enhancement.

Reason this is not marked complete:
- the current codebase does not yet maintain a stable enough persisted reverse index to safely rebuild `happySessionId -> live process/session attachment` after daemon restart
- doing this incorrectly would be worse than exposing a `persisted` warning state

Current approach is intentionally conservative:
- keep continuity metadata
- surface whether it is currently attached or merely persisted
- allow the operator to decide whether to reset or continue from recovered continuity state

## Handoff File Map

### Core daemon runtime
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/daemon/types.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`
- `packages/happy-cli/src/daemon/controlClient.ts`
- `packages/happy-cli/src/api/apiMachine.ts`

### Automation model/runtime
- `packages/happy-cli/src/automation/types.ts`
- `packages/happy-cli/src/automation/AutomationScheduler.ts`
- `packages/happy-cli/src/automation/AutomationStore.ts`
- `packages/happy-cli/src/automation/GuardianSessionRegistry.ts`
- `packages/happy-cli/src/automation/AutomationAudit.ts`
- `packages/happy-cli/src/automation/AutomationAuditStore.ts`

### Shared wire/app types
- `packages/happy-wire/src/machineTypes.ts`
- `packages/happy-app/sources/sync/ops.ts`

### Machine UI
- `packages/happy-app/sources/components/machine/AutomationSummarySection.tsx`
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`

### Project autonomy UI
- `packages/happy-app/sources/components/project/ProjectHealthTab.tsx`
- `packages/happy-app/sources/components/project/SupervisorSummaryCard.tsx`

### Tests / regression coverage
- `packages/happy-cli/src/automation/AutomationAudit.test.ts`
- `packages/happy-cli/src/automation/AutomationAuditStore.test.ts`
- `packages/happy-cli/src/automation/AutomationAutonomyRegression.test.ts`
- `packages/happy-cli/src/automation/GuardianSessionRegistry.test.ts`
- `packages/happy-cli/src/automation/AutomationStatusShape.test.ts`
- `packages/happy-wire/src/machineTypes.test.ts`

## Operator / Reviewer Checklist
If you need to quickly verify the current platform state, check the following in order:
- open the machine detail page and inspect the automation summary card
- open the machine automation detail page and verify counts, guardians, audit stats, audit log, and job list
- verify guardian entries show `attached` vs `persisted`
- verify anomaly alerts are visible when failed/watchdog/stop-request events exist
- run `happy daemon automation list`
- run `happy daemon automation stats`
- run `happy daemon automation audit --anomalies`
- run `happy daemon automation guardians --persisted`

## Prioritized Remaining Work
There are no known blockers for the current automation milestone. The remaining items are enhancements, not core platform gaps.

### Priority 1 — Advanced recovery
Goal:
- implement true daemon restart reattachment for still-live guardian sessions where possible

Desired outcome:
- after daemon restart, guardian entries can move from `persisted` back to `attached` automatically when the underlying live session can be safely rediscovered

Notes:
- this should only be implemented with a robust persisted index / reconciliation strategy
- do not guess or over-associate sessions

### Priority 2 — More proactive anomaly visibility
Goal:
- surface automation anomalies more aggressively

Possible directions:
- machine page banner or stronger red indicator
- project page anomaly summary
- recent anomaly snippet directly on project health card

### Priority 3 — Deep drill-down pages
Goal:
- move from modal drill-downs to dedicated details pages where useful

Most likely candidates:
- dedicated job detail page with longer lifecycle and related events
- dedicated guardian detail page with full reuse/reset history

### Priority 4 — Extended retention / analytics
Goal:
- improve historical usefulness without overcomplicating the core platform

Possible directions:
- configurable audit retention window
- longer time-window views
- richer trend summaries

## Explicit Non-Priorities Right Now
These may be valuable later, but are not recommended before the recovery/visibility items above:
- cross-machine/global aggregation dashboard
- graph-heavy analytics UI
- large new reporting surfaces
- heavy browser-style E2E automation for the current UI

## Implementation Guidance for the Next Person
- treat the current platform as operationally complete, not as scaffolding
- avoid replacing the existing daemon automation control plane with a second system
- prefer extending the current scheduler/audit/guardian flow over adding parallel abstractions
- for recovery work, bias toward correctness and operator visibility over aggressive magic
- if adding new UI, keep machine-level inspection as the primary operational surface
- update this document whenever backlog priority changes or a follow-up item lands

## Fast Restart Point
- For backend continuation, start with `packages/happy-cli/src/daemon/run.ts` and `packages/happy-cli/src/index.ts`.
- For machine UI continuation, start with `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx` and `packages/happy-app/sources/components/machine/AutomationSummarySection.tsx`.
- For project/autonomy UI continuation, start with `packages/happy-app/sources/components/project/ProjectHealthTab.tsx` and `packages/happy-app/sources/components/project/SupervisorSummaryCard.tsx`.
- For schema/API continuity, verify `packages/happy-wire/src/machineTypes.ts`, `packages/happy-cli/src/api/apiMachine.ts`, and `packages/happy-app/sources/sync/ops.ts` together.
- If re-checking against the external reference, focus on `/Users/sangreal/Documents/GitHub/claude-code/src/skills/bundled/loop.ts` and only inspect broader source areas when a concrete gap appears.
