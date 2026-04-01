# Automation Loop Platform

_Last updated: 2026-04-01_  
_Scope: current implementation status, operator surfaces, recovery model, and remaining backlog for Happy's automation/autonomy platform._

## Purpose
For operator workflows, see `docs/automation-operations-guide.md`.

This document is no longer a speculative plan.

Happy's automation platform is now implemented enough that this file should be read as a handoff and status document:
- what already exists
- how the pieces fit together
- where the code lives
- what operators can do today
- what is still intentionally out of scope

At this point, Happy already has a real daemon-backed automation control plane for:
- scheduled and manual automation work
- session-backed execution tracking
- guardian continuity reuse
- automation audit logs and derived stats
- machine-side inspection and control
- generic autonomous agent loops built on the same runtime

## System Shape
The platform is built around one shared runtime, not multiple competing systems.

The main flow is:
- daemon owns the job scheduler and loop coordinator
- automation jobs are persisted locally
- job execution launches or reuses Happy sessions
- guardian continuity is remembered per project/loop continuity key
- audit events are persisted and summarized into usage/stability signals
- CLI and app UI both read/write the same daemon automation state

That means:
- supervisor automation, webhook automation, and generic `agent_loop` automation are all first-class variants of the same automation system
- there is no separate "autonomous loop daemon"
- recovery and observability improvements benefit all automation types together

## What Exists Today

### Runtime and storage
Implemented platform capabilities:
- durable daemon-side automation storage and scheduling for supervisor, webhook, and `agent_loop` jobs
- queue metadata and non-terminal replay on daemon restart
- session-backed job lifecycle tracking until terminal completion
- guardian continuity registry with reuse and reset behavior
- daemon-local audit log persistence and derived audit/guardian usage stats
- durable loop-definition storage for generic autonomous loops
- conservative restart recovery for indexed live sessions
- tmux-backed reverse PID refresh when the persisted PID is stale but the tmux pane is still alive

Primary files:
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/automation/AutomationScheduler.ts`
- `packages/happy-cli/src/automation/AutomationStore.ts`
- `packages/happy-cli/src/automation/GuardianSessionRegistry.ts`
- `packages/happy-cli/src/automation/AutomationAudit.ts`
- `packages/happy-cli/src/automation/AutomationAuditStore.ts`
- `packages/happy-cli/src/automation/AgentLoopStore.ts`
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopRunner.ts`
- `packages/happy-cli/src/daemon/TrackedSessionRegistry.ts`

### CLI operator surface
Implemented operator-facing commands:
- `happy daemon automation list`
- `happy daemon automation status`
- `happy daemon automation timeline`
- `happy daemon automation stats`
- `happy daemon automation audit`
- `happy daemon automation stop <jobId>`
- `happy daemon automation cancel <jobId>`
- `happy daemon automation clear`
- `happy daemon automation guardians list`
- `happy daemon automation guardians clear <key>` / `--all`
- `happy loop create`
- `happy loop list`
- `happy loop show <id>`
- `happy loop update <id>`
- `happy loop pause <id>`
- `happy loop resume <id>`
- `happy loop run-now <id>`
- `happy loop remove <id>`

Useful recovered-session drill-downs are now also first-class in CLI:
- `happy daemon automation list --recovered`
- `happy daemon automation guardians list --recovered`
- `happy daemon automation audit --recovered`

Primary files:
- `packages/happy-cli/src/index.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-cli/src/daemon/controlClient.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`

### App UI surface
Implemented machine-side UI behavior:
- machine automation summary with counts, anomaly indicators, guardian signals, and recovered-session summary
- machine automation detail page with jobs, guardians, guardian usage, audit log, and timeline
- search and filtering for jobs, guardians, and audit events
- dedicated recovered filters for jobs, guardians, and audit events
- deep-link from summary into recovered-only automation views
- machine loop management page for create/edit/pause/resume/run-now/remove
- advanced loop configuration in UI (`agent`, `projectId`, `profileId`, `environmentVariables`)
- drill-down from loop definitions into loop-specific automation history

Primary files:
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`
- `packages/happy-app/sources/components/machine/AutomationSummarySection.tsx`
- `packages/happy-app/sources/sync/ops.ts`

### Wire/API shape
The cross-layer automation state now includes recovered-session metadata and audit stats needed by CLI/UI.

Primary files:
- `packages/happy-wire/src/machineTypes.ts`
- `packages/happy-cli/src/api/apiMachine.ts`
- `packages/happy-cli/src/daemon/controlClient.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`

## Reference Baseline
The design direction here was informed by targeted review of the production-validated automation model in `/Users/sangreal/Documents/GitHub/claude-code`, especially:
- `README.md`
- `src/skills/bundled/loop.ts`

The main lessons adopted into Happy were:
- recurring autonomy should be a durable scheduled primitive
- loops should be manually triggerable, not only time-triggered
- operators need inspectable cadence, continuity, and stop controls
- automation should be visible in the product, not hidden inside prompt magic

Happy intentionally applies those ideas at a different architectural layer:
- Claude Code's `/loop` model is a product interaction pattern
- Happy implements the durable runtime underneath that pattern in the daemon automation control plane
- Happy keeps supervisor workflows and generic agent loops on one shared substrate

## Recovery Model
Recovery is intentionally conservative.

### What recovery does
On daemon restart, Happy can:
- replay queued/dispatching non-terminal jobs from local automation storage
- reattach already-indexed live sessions that are still verifiably running
- keep matching running jobs attached instead of blindly requeueing them
- mark recovered jobs/guardians/audit records for operator visibility

### Recovery safety checks
Happy currently only reattaches a live session when enough evidence exists:
- the session was already indexed by the daemon-local tracked session registry
- the process still exists
- the process still looks like a Happy process
- if a tmux session identifier exists, the tmux target still exists
- the process age does not look implausibly new compared with the persisted record
- if the old PID is stale but tmux is still alive, the current tmux pane PID can be resolved and validated

### What recovery does not try to do
Happy still does **not** attempt:
- broad speculative session discovery across the system
- automatic guardian/session guessing without daemon-local evidence
- unsafe reattachment of arbitrary historical sessions

This is deliberate. A false positive recovery is more damaging than falling back to persisted continuity.

## Observability and Audit
Automation observability is now part of the platform, not an afterthought.

Tracked and surfaced signals include:
- queued / running / completed / failed / cancelled job counts
- guardian remember / reuse / reset counts and reuse rate
- session reattached count after daemon restart
- watchdog stop count
- stop request count
- recent audit events
- recovered guardian/job markers in UI

Relevant event kinds include:
- `job_queued`
- `job_dispatched`
- `job_session_started`
- `job_terminal`
- `guardian_reused`
- `guardian_remembered`
- `guardian_cleared`
- `session_reattached`
- `watchdog_stopped`
- `session_stop_requested`

## What Is Closed for This Milestone
The following should be considered implemented, not backlog:
- basic daemon-side automation orchestration
- durable automation jobs for supervisor/webhook/generic loop work
- guardian continuity persistence and reset controls
- machine-side inspection and control surface
- generic autonomous loop creation and management
- conservative restart reattachment for indexed sessions
- recovered-session visibility in CLI and app UI
- derived audit and guardian usage statistics

## Remaining Backlog
The remaining items are second-phase improvements, not foundational gaps.

### High-value future work
- add deeper daemon integration coverage for tmux PID migration recovery
- optionally surface recovered-state rollups in more project-level or dashboard surfaces
- add richer loop stop conditions, budgets, or policy controls
- sync loop definitions to server/cloud objects if product direction requires it
- support more advanced branching workflow graphs above the current single-loop primitive

### Explicitly not done yet
- broad autonomous self-modification or self-upgrade flows
- a second standalone autonomy daemon
- unsafe recovery of unknown sessions
- Claude Code feature parity as a goal in itself

## Validation Status
The current implementation has passing coverage for the areas touched in this phase:
- automation scheduler behavior
- audit derivation
- tracked session persistence
- agent loop store and coordinator behavior
- automation status shape
- tmux pane PID helper behavior
- app i18n keys for automation/recovery UI
- wire machine automation schema

Representative tests:
- `packages/happy-cli/src/automation/AutomationScheduler.test.ts`
- `packages/happy-cli/src/automation/AutomationAudit.test.ts`
- `packages/happy-cli/src/daemon/TrackedSessionRegistry.test.ts`
- `packages/happy-cli/src/utils/tmux.test.ts`
- `packages/happy-app/sources/text/automationI18n.test.ts`
- `packages/happy-wire/src/machineTypes.test.ts`

## Fast Handoff Summary
If someone picks this work up next, the most important things to know are:
- Happy already has a real shared automation runtime
- generic autonomous loops are implemented on top of that runtime
- the correct next improvements are hardening and policy, not rebuilding the architecture
- restart recovery is intentionally conservative and should stay that way unless stronger evidence is introduced
