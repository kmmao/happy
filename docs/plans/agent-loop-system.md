# Generic Agent Loop System

_Last updated: 2026-04-01_  
_Scope: current implementation status and handoff notes for Happy's generic autonomous Agent Loop system._

## Goal
For day-to-day usage, see `docs/automation-operations-guide.md`.

Happy should support a real generic autonomous Agent Loop system, not only supervisor/webhook-specialized automation.

That goal is now substantially implemented.

The system supports:
- creating a recurring loop from a prompt plus working directory
- running it immediately once and then again on a durable interval
- persisting loop definitions daemon-locally
- reusing guardian continuity per loop when safe
- inspecting, editing, pausing, resuming, triggering-now, and removing loops from CLI and app UI
- observing actual loop executions through the shared automation/audit/guardian surfaces

## Core Architecture
The generic loop system is built on Happy's existing automation platform.

It is made of four parts:
- a loop-definition store
- a loop coordinator
- a new `agent_loop` automation job kind
- a loop runner that spawns the actual agent session

This is an important design decision:
- loops are **not** implemented as a second daemon
- loops are **not** implemented as a sidecar scheduler outside the automation runtime
- loops are a specialization of the main Happy automation control plane

## Implemented Pieces

### 1. Loop definition store
Loop definitions are persisted daemon-locally with the fields needed for scheduling, operator edits, and last-run visibility.

Implemented in:
- `packages/happy-cli/src/automation/AgentLoopStore.ts`

Supported stored state includes:
- `id`
- `name`
- `prompt`
- `directory`
- `intervalMs`
- `enabled`
- `createdAt`
- `updatedAt`
- `nextRunAt`
- `lastEnqueuedAt`
- `lastStartedAt`
- `lastCompletedAt`
- `lastSessionId`
- `lastError`
- `iteration`
- `projectId?`
- `profileId?`
- `agent`
- `environmentVariables?`
- `continuityKey`

### 2. `agent_loop` automation job kind
The automation scheduler now understands `agent_loop` as a first-class job kind.

Each concrete loop tick carries loop execution metadata such as:
- `loopId`
- `loopName`
- `directory`
- `prompt`
- `trigger`
- `iteration`
- `projectId?`
- `profileId?`
- `agent`
- `environmentVariables?`

Implemented in:
- `packages/happy-cli/src/automation/types.ts`
- `packages/happy-cli/src/automation/AutomationScheduler.ts`
- `packages/happy-cli/src/automation/AutomationRunner.ts`

### 3. Loop coordinator
The loop coordinator is responsible for durable scheduling behavior.

Implemented behavior:
- checks for due loops on an interval
- enqueues `agent_loop` jobs when `nextRunAt <= now`
- prevents overlap when a loop already has queued/dispatching/running work
- advances `nextRunAt` after successful enqueue
- supports manual `runNow`
- supports update, pause, resume, and delete operations

Implemented in:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`

### 4. Loop runner
The runner turns a due loop tick into a real session-backed automation job.

Implemented behavior:
- writes the loop prompt to a temp prompt file in the target directory
- spawns a session through the existing daemon session path
- reuses guardian continuity via `agent-loop:<loopId>`
- remembers the latest guardian session after spawn
- annotates the session with automation metadata for auditability

Implemented in:
- `packages/happy-cli/src/automation/AgentLoopRunner.ts`

## Operator Surfaces

### CLI
The CLI surface for generic loops is implemented and usable today:
- `happy loop create`
- `happy loop list`
- `happy loop show <id>`
- `happy loop update <id>`
- `happy loop pause <id>`
- `happy loop resume <id>`
- `happy loop run-now <id>`
- `happy loop remove <id>`

Implemented in:
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-cli/src/index.ts`

### App UI
The machine app has a dedicated loop-management surface.

Implemented behavior:
- create/edit loop definitions
- configure prompt, path, cadence, agent, project, profile, and env vars
- pause/resume/run-now/remove loops
- open the latest session
- jump into loop-specific automation history
- search/filter loop definitions

Implemented in:
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`
- `packages/happy-app/sources/sync/ops.ts`

### Shared automation visibility
Loop executions also show up automatically inside the shared machine automation surface:
- jobs
- guardians
- audit history
- timeline
- recovered-session markers
- recovered-only filters and deep links

Primary files:
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`
- `packages/happy-app/sources/components/machine/AutomationSummarySection.tsx`

## Recovery and Continuity Model

### Guardian continuity
Guardian continuity for generic loops is keyed by:
- `agent-loop:<loopId>`

That means:
- a loop can reuse its own previous guardian session when appropriate
- continuity stays scoped to the loop rather than leaking across unrelated work

### Restart recovery
Loop executions inherit the same conservative recovery model as the rest of the automation runtime.

Implemented today:
- daemon restart can conservatively reattach indexed live sessions
- if the old PID is stale but the tmux pane is still valid, Happy can resolve the pane's current PID and reattach safely
- recovered jobs and guardians are marked for CLI/UI observability
- matching running jobs are preserved instead of being blindly requeued

Not implemented today:
- speculative recovery of unknown sessions
- full general guardian/session recovery beyond the indexed/tmux-backed conservative path

## Reference Alignment with Claude Code
This work was informed by reviewing `/Users/sangreal/Documents/GitHub/claude-code`, especially `src/skills/bundled/loop.ts`.

The most relevant ideas carried over were:
- recurring work should be durable
- loops should run immediately once when created or manually triggered
- operators need pause/resume/remove controls
- autonomy needs visible history and state

Happy deliberately does **not** copy Claude Code 1:1.

Instead, Happy translates the production-validated `/loop` lessons into its own architecture:
- daemon-local durable storage
- shared automation runtime
- guardian continuity
- auditability and machine inspection
- app/CLI surfaces grounded in the same system state

## What Is Included Now
Included in the current implementation:
- daemon-local loop persistence
- `agent_loop` job kind
- durable interval scheduling
- single-flight overlap prevention per loop
- guardian reuse per loop
- CLI create/list/show/update/manage surface
- app UI create/edit/manage surface
- loop-specific automation drill-downs
- conservative daemon restart reattachment for indexed live sessions, including tmux-backed pane PID refresh
- recovered-session visibility in automation UI and CLI

## What Is Still Out of Scope
Not included yet:
- loop definitions synced to server as first-class cloud objects
- rich stop conditions or branching workflow graphs
- broad autonomous self-iteration policies above the current loop primitive
- speculative reattachment of arbitrary historical sessions

## Success Criteria Status
The original success criteria are now effectively met for the first cut:
- `happy loop create --path <repo> --interval 10m --prompt "check CI and propose next fix"` can define a durable loop
- creation can trigger an immediate first run
- the loop persists across daemon restarts
- future runs are re-enqueued on schedule
- `happy loop list` and related commands expose the lifecycle from CLI
- the machine app can create/edit loops and jump into automation history
- daemon restart can conservatively reattach indexed live sessions and preserve running automation jobs
- machine automation views show jobs, audit history, guardian continuity, and recovered-session markers

## Recommended Next Work
If loop work continues, the next valuable improvements are:
- add deeper daemon integration coverage for tmux PID migration recovery
- add policy controls such as budgets, stop conditions, or cadence caps
- decide whether loop definitions should stay daemon-local or become synced product objects
- only consider broader recovery if a stronger evidence model is introduced

## Fast Handoff
The key handoff point is simple:
- Happy already has a genuine generic Agent Loop runtime
- the right next step is hardening and policy refinement
- the wrong next step would be rebuilding a second loop system outside the shared automation platform
