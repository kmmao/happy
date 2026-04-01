# Generic Agent Loop System

_Last updated: 2026-04-01_  
_Scope: current implementation status and handoff notes for Happy's generic autonomous Agent Loop system._

## Goal
For day-to-day usage, see `docs/automation-operations-guide.md`.

Happy should support a real generic autonomous Agent Loop system, not only supervisor/webhook-specialized automation.

That goal is now substantially implemented.

The system supports:
- tracking runtime state and current phase (`sleeping`, `planning`, `acting`, `blocked`) per loop
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
The coordinator is now also the first version of the loop runtime state machine.

It tracks:
- runtime state (`idle`, `active`, `blocked`, `paused`)
- current phase (`sleeping`, `planning`, `acting`, `blocked`)
- active job/session references
- last trigger source and timestamp
- blocked reason after failed autonomous runs

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
- loop runtime/phase visibility in CLI and machine loop UI

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

## Recent Autonomy Upgrade: Event Inbox + Durable Memory

The generic loop system now moves beyond simple interval scheduling.

New autonomy capabilities:
- **event inbox** per loop, with `pending` / `dispatched` / `completed` / `failed` / `cancelled` / `ignored` statuses
- **manual event injection** from CLI and app UI
- **durable loop memory** persisted in the repo-local support path:
  - `.happy/agent-loops/<loopId>/memory.md`
  - `.happy/agent-loops/<loopId>/context.md`
- **memory-backed prompt injection** so each autonomous run starts with durable goal/focus/memory/reflection context
- **post-run memory resync** so edits written by the agent into `memory.md` are pulled back into loop state after the run finishes

Stored loop state now also includes:
- `goal?`
- `currentFocus?`
- `workingMemory?`
- `lastReflectionSummary?`
- `memoryUpdatedAt?`
- `recentEvents?`

Operator surfaces now expose:
- CLI create/update flags for memory seeding (`--goal`, `--focus`, `--working-memory`, `--reflection`)
- CLI show output for durable memory path and latest memory snapshot
- App UI fields for goal/focus/working memory/reflection summary
- loop detail visibility for recent events and memory freshness

Important implementation files:
- `packages/happy-cli/src/automation/AgentLoopMemory.ts`
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopRunner.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: Smart Loop Recommendations

Happy now includes a first-pass suggestion engine for bootstrapping autonomous loops from a repository path.

New capabilities:
- analyze a target directory and infer useful candidate loops
- detect common signals such as CI workflows, package manifests, docs surfaces, Docker/runtime descriptors, and Git repos
- mark suggestions that are already configured to avoid duplicate loop creation
- expose the recommendation flow in both CLI and machine app UI

Current operator surfaces:
- CLI: `happy loop suggest --path <repo>`
- CLI materialization: `happy loop suggest --path <repo> --create [--run-now]`
- App UI: analyze path → review suggestions → adopt missing loop definitions

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopSuggestion.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: File-Watch Wakeups

Happy loop now supports daemon-local repository file watching as another proactive wakeup source.

Implemented behavior:
- opt-in `fileWatchEnabled` per loop
- daemon-managed recursive file watch on the loop directory
- debounce and coalesce changed file paths into a single event
- emit `file-watch` events into the loop event inbox
- ignore noisy/self-generated paths such as `.git`, `.happy`, `node_modules`, `dist`, `build`, `coverage`, `.next`, and `.turbo`

This is intentionally a first-cut bridge:
- it makes loop wakeups more autonomous today
- it avoids self-trigger loops from memory/context writes
- it does not yet provide fine-grained watch include/exclude policies


## Recent Autonomy Upgrade: Bootstrap Profiles Daemonization

Happy now supports daemon-managed bootstrap profiles that periodically discover repositories and materialize missing loops.

Implemented behavior:
- persisted bootstrap profiles under Happy home
- scheduled repo discovery on a root directory
- automatic bulk materialization of missing loop suggestions
- optional `autoRunCreatedLoops` for immediate activation
- CLI + machine UI management surface for the bootstrap profiles themselves

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopBootstrapStore.ts`
- `packages/happy-cli/src/automation/AgentLoopBootstrapCoordinator.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: Repo Bootstrap Orchestration

Happy now supports scanning a workspace root, discovering git repositories, and materializing loop plans in bulk.

Implemented behavior:
- local git repo discovery under a root path
- bootstrap planning from repo → suggested loops
- CLI bulk materialization via `happy loop bootstrap ...`
- App UI repo scan and per-repo bulk adoption
- reuse of existing loop suggestion engine and dedupe rules

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopBootstrap.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: Failure Budget and Retry Backoff

Happy loop now supports configurable self-recovery before escalating into a blocked state.

Implemented behavior:
- per-loop `maxConsecutiveFailures`
- per-loop `retryBackoffMs`
- `consecutiveFailures` tracked in loop state
- transient failures can reschedule the next run instead of hard-blocking immediately
- successful/manual recovery resets the failure streak

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopStore.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: First-Class CI Bridge

Happy loop now supports first-class CI wakeups instead of relying only on generic webhook heuristics.

Implemented behavior:
- opt-in `ciBridgeEnabled` per loop
- dedicated daemon ingress for `ci-trigger` payloads
- repo-aware matching from CI event → eligible loops
- source mapping for `workflow_run`, `check_run`, `check_suite`, and generic CI triggers
- CLI simulation surface: `happy loop ci-event ...`
- App UI advanced toggle for CI bridge enablement

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCiBridge.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`
- `packages/happy-cli/src/daemon/controlClient.ts`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopFileWatcher.ts`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: GitHub Webhook Bridge

Happy loop now includes a first-pass GitHub webhook bridge layered on top of the existing webhook automation pipeline.

Implemented behavior:
- opt-in `githubBridgeEnabled` per loop
- reuse existing `webhook-trigger` ingress from the daemon
- when a webhook event arrives, emit a parallel `github-webhook` event into matching loop inboxes
- match loops by enabled bridge flag plus repo-path containment
- preserve the original webhook automation behavior while also notifying generic loops

This is intentionally scoped:
- it bridges current issue/webhook events into the autonomy substrate
- it does not yet model all GitHub event families or CI-specific webhook payloads as first-class loop trigger policies

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopWebhookBridge.ts`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Autonomy Upgrade: Event Filtering Policies

Happy loop now supports first-pass event filtering policies at the loop-definition layer.

Implemented behavior:
- `eventSourceAllowlist?`: optional source allowlist such as `github-webhook`, `file-watch`, `manual`, `ui`
- `eventKeywordFilters?`: optional keyword list matched against event title/details
- rejected events are retained for observability but stored as `ignored`
- ignored events never auto-dispatch into loop runs

This matters because the loop runtime now has multiple proactive wakeup sources:
- schedule
- manual/UI events
- file-watch wakeups
- GitHub webhook bridge events

Filtering gives operators a way to keep a loop autonomous without making it noisy or overly trigger-happy.

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Latest Closure: Auto-Run Policy Layer

Happy loop now has a first-pass policy layer for autonomous runs.

Implemented behavior:
- `cooldownMs` blocks overly-frequent automatic reruns
- `quietHoursStart` / `quietHoursEnd` suppress schedule/event runs during local quiet windows
- `maxAutoRunsPerDay` caps automatic runs per local day window
- pending events are retained when gated instead of being dropped
- manual `run-now` bypasses these auto-run policies

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopStore.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Latest Closure: GitHub Actions Provider Adapter

Happy loop now includes a real GitHub Actions webhook adapter layered into the existing CI trigger substrate.

Implemented behavior:
- converts `workflow_run` / `check_run` / `check_suite` payloads into `ci-trigger`
- supports explicit repo path targeting and loop-id targeting
- falls back to repo URL matching via git `origin` remote when repo path is absent
- exposes CLI ingress through `happy loop github-actions-webhook ...`

Primary implementation files:
- `packages/happy-cli/src/automation/GitHubActionsCiAdapter.ts`
- `packages/happy-cli/src/automation/GitRemote.ts`
- `packages/happy-cli/src/automation/AgentLoopCiBridge.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`
- `packages/happy-cli/src/commands/loop.ts`

## Latest Closure: Multi-Loop Orchestration

Happy loop now supports lightweight downstream orchestration while staying inside the existing daemon loop runtime.

Implemented behavior:
- per-loop downstream targets via `downstreamLoopIds`
- per-loop trigger conditions via `downstreamTriggerOn`
- upstream terminal states emit derived downstream events:
  - `loop-completed`
  - `loop-failed`
- downstream loops receive those as normal loop events and follow existing policy gates / filters

Design intent:
- keep orchestration event-driven and minimal
- avoid introducing a second scheduler, workflow graph runtime, or DAG engine

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AgentLoopStore.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Latest Closure: Policy Auditability + Chain Navigation

Happy loop now exposes policy-gating and downstream-orchestration observability through the existing automation surface.

Implemented behavior:
- records `loop_policy_gated` audit events when auto-runs are deferred by loop policy
- records `loop_downstream_emitted` audit events when upstream loops fan out to downstream loops
- surfaces aggregate counts in automation audit stats
- stores `lastPolicyGateAt` and `lastPolicyGateReason` on loop runtime state
- surfaces policy-state and upstream/downstream navigation in the Loops UI

Primary implementation files:
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/automation/AutomationAudit.ts`
- `packages/happy-cli/src/index.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/automation.tsx`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

## Recent Closure: Kairos Brief + Auto-Dream

### Kairos-style proactive brief layer
Completed in this round:
- loop terminal completion now generates a durable brief markdown file
- brief metadata is persisted on the loop object
- loop terminal paths can emit push notifications and/or webhook notifications
- CLI supports `happy loop brief <id>`, `happy loop memory <id>`, `happy loop context <id>`, and notify configuration flags
- machine loop UI shows brief-related metadata
- machine loop UI can open a dedicated viewer page for the latest brief content with copy/search/highlighted search/focused-vs-full search modes/match-navigation/auto-refresh/change detection/auto-switch-to-diff/diff/clear-snapshot/open-path controls, plus direct memory/context file drill-down

Primary files:
- `packages/happy-cli/src/automation/AgentLoopBrief.ts`
- `packages/happy-cli/src/automation/AgentLoopCoordinator.ts`
- `packages/happy-cli/src/commands/loop.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

### Auto-Dream daemon service
Completed in this round:
- daemon-managed Auto-Dream profile store and coordinator
- periodic scan of `.happy/agent-loops/**/memory.md`
- generation of `.happy/auto-dream/<profileId>/dream-latest.md`
- CLI CRUD/control surface via `happy loop dream-profile ...`
- machine loop UI management surface for Auto-Dream profiles
- machine loop UI can open a dedicated viewer page for the latest Auto-Dream report with copy/search/highlighted search/focused-vs-full search modes/match-navigation/auto-refresh/change detection/auto-switch-to-diff/diff/clear-snapshot/open-path controls

Primary files:
- `packages/happy-cli/src/automation/AutoDreamStore.ts`
- `packages/happy-cli/src/automation/AutoDreamCoordinator.ts`
- `packages/happy-cli/src/daemon/run.ts`
- `packages/happy-cli/src/daemon/controlServer.ts`
- `packages/happy-app/sources/sync/ops.ts`
- `packages/happy-app/sources/app/(app)/machine/[id]/loops.tsx`

### Operational interpretation
The architecture is now split clearly:
- **Loop runtime**: creates and maintains actual autonomous agent work cycles
- **Kairos brief**: summarizes completed loop work and emits proactive signals
- **Auto-Dream**: consolidates background memory across loops without spawning a second agent runtime

This keeps autonomy inside the same Happy daemon automation plane rather than creating a parallel system.


- loop policy now supports `maxIterations` and `stopOnSuccess` so autonomous runs can terminate cleanly without manual cleanup
