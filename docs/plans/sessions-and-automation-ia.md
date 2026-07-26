---
status: accepted
phase: phase-3-complete
implemented: 2026-06-13
relates-to: ADR-0022 (AgentLoop convergence)
---

# Sessions × Automation IA — unifying manual conversations and scheduled work

> ⚠️ **知识库子系统已于 2026-07-26 整体移除**（代码、API、UI、数据表）。本文中涉及 Knowledge 的条目为当时状态的记录，保留以备追溯。详见 `docs/plans/knowledge-removal-plan.md`。

> **Status: ACCEPTED & IMPLEMENTED (Option B, phases 1–3).** The Workflow term is now in CONTEXT.md. The Sessions tab has been renamed to Workflows and renders the `useWorkflows()` derivation. The legacy machine sub-pages (automation / loops / tasks / triggers / webhook-trigger) and their support modules have been removed. Phase 2's "Make this recurring" promote action is shipped on Ad-hoc Workflow detail pages; "Attach to existing Loop" and "Promote to Loop" are gated on the CLI/Agent update tracked in ADR-0022 phase 3b.

## TL;DR

Today Happy has **all the data plumbing** to relate manual conversations and scheduled / triggered work — `Session`, `Task`, `Trigger`, `AgentLoop`, `GuardianSessionRegistry` are wired end-to-end — but the App presents them as **two parallel worlds**. A user who runs `happy` in a terminal and then wants the same workflow to run nightly has no in-app path: they leave the conversation, navigate to a Machine detail page, find one of five different sub-pages (`automation` / `tasks` / `loops` / `trigger-schedule` / `webhook-trigger`), and build a Trigger from scratch — losing context, prompts, and the fact that there *was* a previous conversation that did this exact thing manually.

This PRD scopes a 1-week-plus information-architecture rework that introduces a single user-facing primitive — **Workflow** — as a *view* over existing data, not a new database entity. Every Session is rendered as belonging to a Workflow. Ad-hoc Workflows are auto-created for manual conversations. Promote-in-place becomes "add a Trigger to this Workflow". Five fragmented automation sub-pages collapse into one Workflow detail page.

Three options are surfaced (A: minimal "adopt-only" patch, B: Workflow-overlay, C: deep Workflow-as-entity rewrite). The **recommendation is Option B**, in three phases over ~3 weeks of effort; Phase 1 (read-only overlay) ships in week 1 and is independently valuable. Option B is additive on the wire, requires zero data migration, and survives a not-yet-completed parallel ADR (ADR-0022 AgentLoop convergence) without conflict.

---

## 1. Background and current state

### 1.1 The vocabulary we already have

Per [CONTEXT.md](../../CONTEXT.md), Happy's automation domain is already rich:

- **Session** — a single Claude/Codex conversation bound to a Machine. 1:1 with a native Claude Code session.
- **Task** — an automated *work unit* with status state machine `queued → dispatching → running → completed/failed/cancelled`. Created manually, by `TriggerSchedule`, or by `WebhookTrigger`. **Each Task creates or reuses at most one Session.** Can nest via `parentTaskId`.
- **Trigger** — umbrella for `TriggerSchedule` (cron) and `WebhookTrigger` (event). Each fire produces a new Task.
- **AgentLoop** — long-running agent bound to a Machine + directory, executing a goal-driven prompt on cron / file-watch / CI / webhook, with working memory across iterations. Has a `role` discriminator (`generic` | `supervisor`). Per ADR-0022 the supervisor flavor is the autopilot; the generic flavor is the user-defined long-running agent.
- **GuardianSessionRegistry** (CLI runtime concept, not in CONTEXT.md language) — an in-memory + on-disk registry the Daemon keeps that remembers which Happy Session ID was used for each `(loop, project, continuityKey)` tuple, so the next trigger fire can resume the same Session.

Crucially: **the data layer already supports "this Session belongs to that automation"** via `Session.metadata.automationContext = { kind, trigger, projectId, runId, loopId }`. The App just doesn't render the relation.

### 1.2 What the user sees today

Confirmed by code investigation (Appendix A):

**Automation is "machine-centric and fragmented."** Every automation-adjacent surface lives under `Machine [id] / *`:

| Sub-page | Purpose | Size |
|---|---|---|
| `machine/[id]/automation` | Pipeline overview (Jobs → Guardians → Audit), timeline | 73 KB |
| `machine/[id]/tasks` | Task Kanban (status columns) | (large) |
| `machine/[id]/loops` | AgentLoop / SupervisorLoop list, brief preview, history | 45 KB |
| `machine/[id]/trigger-schedule/*` | Cron Trigger CRUD | — |
| `machine/[id]/webhook-trigger/*` | Webhook Trigger CRUD | — |

Plus modals: `LoopEditorModal` (54 KB), `BootstrapProfileEditorModal` (17 KB), `OneClickSetupCard` (22 KB), `SkillPickerModal`, `DetailSheet` (14 KB).

There is no top-level "Automation" navigation. There is no "Workflow" / "Job" / "Routine" concept at all in the UI. The Sessions tab and the Machine → Automation sub-pages do not link to each other (you can't open a Session and ask "what triggered me", and you can't open a Trigger and ask "show me the Sessions it produced").

### 1.3 The "manual → automation" gap, confirmed by code

The earlier code investigation produced these conclusions (file:line in Appendix A):

1. The only fields that distinguish a manual Session from an automated one are `metadata.startedBy ∈ {"terminal", "daemon"}` and `metadata.automationContext`.
2. `GuardianSessionRegistry.remember(sessionId)` only accepts Sessions the dispatcher itself just created. There is no `attach(existingSessionId)`. No CLI command, no RPC, no App action lets a user say "this Session I started manually — keep using it for the next trigger fire".
3. Triggers (cron + webhook) and AgentLoops both resolve Sessions through the registry. A Session the registry doesn't know about is invisible to automation.
4. The wire schema reserves `AutomationGuardianSummary.attached: boolean` but no producer or consumer reads it — the design left an empty seat that has never been filled.

So today's situation is: **the data joins exist, but the registry is a closed system that only the dispatcher writes to.** A user-driven "adopt" path needs ~2 days of backend wiring (Appendix A §A6).

### 1.4 What's hiding behind the current UI

Several capabilities are fully implemented in code but have no App entry point (Appendix A §A5):

| Capability | Schema | UI? |
|---|---|---|
| Task nesting (`parentTaskId`) | yes | no |
| Generic-role AgentLoop | yes (Phase 3a) | no (Phase 3b not landed) |
| AgentLoop cascade (`downstreamLoopIds`) | yes | no |
| Session fork (`forkedFromSessionId`) | yes | no |
| Knowledge supersession | yes | no |
| TaskSkillBinding ordering | yes | no |
| `Project.autoLoopHealthThreshold` | yes | no |
| Worktree isolation | yes | partial (create-only) |

These are *latent power* the IA rework can expose progressively without adding new code paths.

---

## 2. Goals and non-goals

### 2.1 Goals

1. **One mental model for the user.** Whatever they do — start a conversation, schedule a job, configure a loop — they're operating on the same kind of object.
2. **Promote-in-place.** A manual conversation can be turned into a recurring / triggered workflow without leaving the conversation and without losing context.
3. **Traceability in both directions.** From a Session row, see "what triggered me / what loop am I part of". From a Trigger / Loop, see "which Sessions have I produced".
4. **Backward-compatible data.** Existing Sessions, Tasks, Triggers, AgentLoops keep working. Old clients keep rendering. No destructive schema migration. Compatible with the in-flight ADR-0022 (AgentLoop convergence) without blocking it.
5. **One-week PoC, three-week alpha.** Phase 1 is read-only display that ships value immediately; later phases add write actions.

### 2.2 Non-goals

- Replacing or unifying the underlying primitives (`Task`, `AgentLoop`, `Trigger` remain distinct in the data model under Options A and B).
- Multi-machine workflows or cross-Account collaboration (orthogonal; future work).
- Replacing the Claude/Codex Session as the conversation unit. Sessions stay 1:1 with native sessions.
- A no-code workflow builder (this is an IA cleanup, not a Zapier clone — Happy's "steps" are one Session, not a node graph).
- Touching the underlying scheduler / dispatcher logic. The PRD is App-side IA + a thin "adopt" wire RPC for promote-in-place.

---

## 3. The proposed primitive: Workflow

### 3.1 What a Workflow is (and is not)

A **Workflow** is the unit a user thinks of as "a thing I'm asking Happy to do."

It is a **view over existing entities**, not a new database entity (under Option B; Option C makes it real). In data-model terms, a Workflow is centered on **one of `AgentLoop | TriggerSchedule | WebhookTrigger | Session`**, with its produced or contained Sessions hung off it:

| Workflow kind | Center entity | Sessions per Workflow | Trigger? |
|---|---|---|---|
| **Ad-hoc** | a Session (no Loop, no Trigger) | exactly 1 | — |
| **Scheduled** | a `TriggerSchedule` | 1+ (one per fire, possibly via Guardian re-use) | cron |
| **Event-driven** | a `WebhookTrigger` | 1+ | webhook |
| **Loop** | an `AgentLoop` (any role) | 1+ across iterations (Guardian-keyed) | optional Trigger(s) attached |

A Workflow is **not** a Task. A Task is one *execution* (one fire / one iteration / one user-issued command). Under Option B's mapping, "Task" becomes "Workflow Run" — the per-execution row inside a Workflow's history.

### 3.2 Why a Workflow, and not just "list AgentLoops + Triggers + Sessions"

Three reasons:

1. **One name for what users think about.** Today they have to keep five names straight (Session / Task / Trigger / Loop / Supervisor). Workflow folds those into one term that the rest of the IA flows from.
2. **Promote-in-place becomes a category-shift, not a data-shift.** A user adds a Trigger to an Ad-hoc Workflow and it transitions to Scheduled. The underlying Session keeps its id, history, and conversation. We name the thing they're shifting *between*.
3. **The kind discriminator carries forward.** Filter chips on the list (`All / Ad-hoc / Scheduled / Event / Loop`) and the differing detail-page layouts naturally derive from one tagged union.

### 3.3 Lifecycle (the promote-in-place graph)

```
                    ┌──────────────────────────────────┐
                    │     Ad-hoc Workflow (manual)     │
                    │     1 Session, no Trigger        │
                    └──────────────┬───────────────────┘
                                   │ user adds a Trigger
                                   ▼
                    ┌──────────────────────────────────┐
                    │   Scheduled / Event Workflow     │
                    │   1+ Sessions (Guardian-reuse)   │
                    │   1 TriggerSchedule or           │
                    │     WebhookTrigger               │
                    └──────────────┬───────────────────┘
                                   │ user attaches an AgentLoop
                                   ▼
                    ┌──────────────────────────────────┐
                    │       Loop Workflow              │
                    │   1+ Sessions across iterations  │
                    │   1 AgentLoop                    │
                    │   0+ Triggers (cron / file / …)  │
                    └──────────────────────────────────┘
```

Arrows are user actions, not automatic transitions. A Workflow can also be born directly as Scheduled / Loop via the existing automation UI paths (these are preserved, not removed).

### 3.4 Identity

In Option B (recommended): a Workflow's stable identity is derived — `kind:centerEntityId`. For Ad-hoc it's `adhoc:sessionId`; for Scheduled it's `scheduled:triggerScheduleId`; etc. No new ID space.

In Option C: every Workflow has a real DB `workflowId` and every Session / Trigger / Loop carries `workflowId NOT NULL`.

---

## 4. Options

### 4.1 Option A — Minimal "Adopt-only" patch (no IA change)

**Scope.** Add a single new action — *Adopt this Session into a Loop* — on each manual Session. The sessions list, the automation pages, and the navigation stay as they are.

**Backend changes.**
- New wire RPC `sessionAdoptToLoop(sessionId, loopId)`.
- `GuardianSessionRegistry` gains `attach(existingSessionId, key)`.
- Server emits a `SyncUpdate` recording that `automationContext` was added to the Session.

**Frontend changes.**
- Session row long-press menu: "Adopt into existing Loop" → picker.
- "Create Loop from this Session" modal — pre-fills with Session's directory and recent prompt.
- Session row tag: `loop:<name>` when adopted.

**Pros.**
- ~3 days of work.
- Zero IA disruption — old behavior preserved.
- Unblocks the "I want this to run nightly" use case.

**Cons.**
- Doesn't address fragmentation. The user still mentally maps Session ↔ Loop ↔ Trigger ↔ Task themselves.
- Each automation primitive keeps its own page; navigation stays five-pronged.

**Pick this if** you believe the current IA is fundamentally fine and "promote to automation" is the only acute pain point.

---

### 4.2 Option B — Workflow overlay (recommended)

**Scope.** Introduce a `Workflow` *view* in the App. Workflows are computed from existing entities — no new database table, no new wire entity. The fragmented automation pages collapse into one Workflow detail surface.

**Data model.** Unchanged. The Workflow view is a tuple `(kind, centerEntity, sessions[], runs[])` derived from existing data:

| Workflow kind | Built from | "Sessions" field | "Runs" field |
|---|---|---|---|
| Ad-hoc | a Session with no automation context | `[session]` | `[]` (no Task rows) |
| Scheduled | a `TriggerSchedule` row | join via `Task.triggerRef = triggerSchedule.id` then `Task.sessionId` | the matching Tasks |
| Event-driven | a `WebhookTrigger` row | same pattern | matching Tasks |
| Loop | an `AgentLoop` row | join via `Session.metadata.automationContext.loopId` | (depends on role) |

The mapping is deterministic and pure-client-side. Sessions with no automation owner become Ad-hoc Workflows.

**Wire changes.** Minimal.
- Surface `Session.metadata.automationContext` to the sessions list view (already in storage; just consumed by the new view).
- Optional: a new lightweight `Session.automationProvenance` field returned by the server's session-list endpoint — a denormalized join `{ workflowKind, workflowId, workflowDisplayName }` so the list view doesn't have to join client-side. Pure performance optimization; not required for Phase 1.
- `sessionAdoptToLoop` RPC from Option A (needed in Phase 2 for promote-in-place).

**Frontend changes.** Larger.
- New `useWorkflows()` hook deriving Workflows from Sessions + AgentLoops + Triggers in storage. Memoized.
- `SessionsList.tsx` refactored to show one row per Workflow. Workflows with multiple Sessions collapse / expand to show their Sessions inline.
- The five Machine → Automation sub-pages collapse into one **Workflow Detail page** reachable by tapping any Workflow row.
- The Machine detail page no longer hosts the automation grid (that grid moves to the Sessions tab top, as already shipped in the most recent commit).
- New "promote" affordance on Ad-hoc Workflows: "Make this recurring", "Attach to a Loop".
- Filter chips at the top of the Workflow list: `All / Ad-hoc / Scheduled / Event / Loop`.

**Pros.**
- One mental model, one navigation surface.
- Zero data migration (derived view).
- Preserves existing automation primitives — Triggers can still be created via the existing flow; they just render in the Workflow list.
- Promote-in-place falls out for free.
- **Compatible with ADR-0022 in flight.** Because we view through `AgentLoop`, the generic-role rollout (Phase 3b) lights up new Loop Workflows automatically as the server-wire connection lands — no IA churn.

**Cons.**
- ~2 weeks of frontend rework.
- The derivation must handle edge cases: orphaned Sessions, Triggers that have never fired, Loops with stopped status, generic-role Loops still living CLI-locally (ADR-0022 Phase 3b).
- `useWorkflows()` must be efficient (memoized + indexed) — sessions list is hot.

**Pick this if** you want a real UX leap without paying the cost of a schema rewrite. **Recommended for the typical team.**

---

### 4.3 Option C — Deep rewrite (Workflow as first-class entity)

**Scope.** Introduce `Workflow` as a real DB entity. Every Session gains a required `workflowId`. Triggers and AgentLoops become *part of* a Workflow, not parallel concepts. The data model is rebuilt around Workflow.

**Data model.**
- New `Workflow` table: `{id, accountId, machineId, projectId?, kind, createdAt, archivedAt, displayName}`.
- `Session.workflowId NOT NULL`.
- `TriggerSchedule.workflowId NOT NULL`, `WebhookTrigger.workflowId NOT NULL`, `AgentLoop.workflowId NOT NULL`.
- Migration backfill: for each existing manual Session create an Ad-hoc Workflow; for each Trigger / Loop create a Workflow and reassign its produced Sessions.
- `GuardianSessionRegistry` keyed by `workflowId` instead of `(project, loopId, continuityKey)`.

**Wire changes.** Breaking.
- Major version bump of `@kmmao/happy-wire`.
- New entity in `SyncUpdate`, new ingest path.

**Pros.**
- Cleanest mental model.
- `Workflow` becomes a first-class permission / sharing boundary (useful for future team features).
- Enables features that need workflow-level identity: cross-Machine workflows, workflow templates, workflow-level cost accounting.

**Cons.**
- Multi-week migration. Backfill, dual-write, dual-read window across CLI / Agent / Server / App / Codium / Wire.
- Breaks all wire clients until they upgrade.
- High risk of orphan-data bugs during migration.
- The 5+ existing automation primitives' CRUD paths all need re-routing through Workflow.
- **Conflicts with ADR-0022's mid-flight schema shifts.** Doing Option C while AgentLoop's `role` discriminator + `genericConfig` JSON migration is still landing doubles the change surface.

**Pick this if** you believe Workflow will become a sharing / collaboration / cross-Machine boundary, and the cost of a clean schema is worth paying now, and ADR-0022 has fully landed first.

---

## 5. Competitive context

Five products surveyed in depth (Appendix B). Five IA patterns identified:

| Pattern | Representative | Verdict for Happy |
|---|---|---|
| Trigger-decision separation (Trigger ↔ Steps decoupled) | n8n, Pipedream | **Closest to Option B.** Happy's "Steps" is a single Session, not a node graph, but the Trigger-as-pivot mental model maps directly. |
| Default-automated linear flow (no manual run) | Zapier | Wrong philosophy for Happy. Happy's manual conversations are a primary use case, not a test mode. |
| Multi-trigger workflow (one Workflow, many Triggers) | Pipedream | A Phase 4+ direction. Happy's data model could support it (Workflow → many Triggers) but it's not the first-cut need. |
| Workflow-as-code (YAML declarative) | GitHub Actions | Wrong philosophy. Happy users don't write YAML; they have conversations. |
| Event-sourced replay | Temporal | Architecturally orthogonal. AgentLoop's iteration history rhymes with this — possible future for SupervisorLoop run-replay UX. |

**Most-instructive comparable: Cursor Cloud Automations** (released 2025). Cursor has the exact shape Happy is moving toward — Cloud Agent tasks can be **manually run** or **scheduled** to repeat. The model is: a Task definition is the Workflow, individual runs are children, the same UI surface lets you "Run now" or "Schedule". Cursor solved the same fragmentation problem; their pattern validates Option B.

**Reverse lesson from Zapier**: Zapier deliberately has no "manual run" because they treat automation as the only mode. Trying to retrofit manual conversations into a Zapier-style IA would force every Happy Session into a fake "Trigger: Manual Run" entry. That violates Goal 1 (one mental model) more than it helps.

---

## 6. Recommendation: Option B, three phases

Option B preserves the existing data model (cheap), delivers the IA win (high), and leaves Option C as a future possibility if Workflow ever needs first-class identity. The phasing makes Phase 1 ship in week 1.

### Phase 1 — Read-only Workflow overlay (~5 days)

**Deliverable.** The sessions list shows Workflows as rows. Each row contains its Sessions (visible / collapsible). Each Workflow has a kind icon (Ad-hoc / Scheduled / Event / Loop). Tapping a Workflow opens a Workflow detail page that aggregates today's `automation`/`loops`/`tasks` views into one place.

No write actions yet. Triggers, Loops, and Sessions are still created through their existing entry points; this phase only changes how they're displayed.

**Implementation outline.**
1. Add `useWorkflows()` hook in `packages/happy-app/sources/hooks/`. Reads from storage; memoizes; emits `Workflow[]` derived from Sessions + AgentLoops + Triggers + Tasks.
2. Replace `SessionsList.tsx` body with a `WorkflowList` rendering the new view.
3. Replace the existing automation header (just landed in this commit history) with a Workflow filter chip row (`All / Ad-hoc / Scheduled / Event / Loop`).
4. Add `app/(app)/workflow/[id].tsx` — Workflow detail page consolidating the old `automation/loops/tasks` views.
5. Keep the existing automation sub-pages as fallback for one release window so deep-link bookmarks don't break.

**Acceptance criteria.**
1. Every existing Session appears in the new view, either inside its Workflow or as an Ad-hoc Workflow.
2. The previously-shipped per-machine automation header on the sessions list is folded into the new view (no double presentation).
3. Selecting a Workflow's Session and selecting the Workflow itself have intuitive destinations (Session → conversation; Workflow → detail page).
4. No data migration. Existing CLI / Server / Agent versions keep working.
5. The new sessions list renders the typical case (≤200 sessions, ≤30 workflows) at ≥60fps on web, ≥60fps on iPhone 12 equivalent.
6. Generic-role AgentLoops that are still CLI-local (ADR-0022 Phase 3b not yet landed) show up as Loop Workflows with a "CLI-local" indicator — they're not invisible, but they're flagged as having reduced server-side visibility until Phase 3b lands.

### Phase 2 — Write actions: promote + edit (~5 days)

**Deliverable.** From an Ad-hoc Workflow, the user can:
- **"Make this recurring"** — opens a cron / interval picker, creates a `TriggerSchedule`, atomically rewires the existing Session into the resulting Scheduled Workflow.
- **"Attach to existing Loop"** — picker of running Loops on the same Machine.
- **"Promote to Loop"** — creates an `AgentLoop` from the current Session's directory + initial prompt.

This phase adds the `sessionAdoptToLoop` wire RPC (Appendix A §A6) and the server-side `automationContext` mutation hook.

**Implementation outline.**
1. Wire: `sessionAdoptToLoop(sessionId, target: { kind: "loop", loopId } | { kind: "newLoop", config } | { kind: "schedule", cron, ... })`.
2. Server: handle each target kind, update `Session.metadata.automationContext`, emit `GuardianSessionRegistry.attach()` to the Daemon, emit `SyncUpdate(session-updated)`.
3. App: promote modal UI, optimistic local update, error handling.
4. Demote action: remove all Triggers/Loops; Workflow returns to Ad-hoc.

**Acceptance criteria.**
1. After promotion, the Session's `metadata.automationContext` reflects the new owner.
2. After promotion, the Guardian registry knows about the Session (the next fire reuses it).
3. The Workflow detail page updates without full reload after promotion.
4. Demote is reversible — Workflows can return to Ad-hoc.
5. Promote from a Session being archived shows a sensible error (don't adopt zombies).

### Phase 3 — Cleanup, top-level surfacing, documentation (~3 days)

**Deliverable.**
- Old automation/loops/tasks/trigger sub-pages on the Machine detail screen are removed (their content already lives in the Workflow Detail page).
- Settings → Machine no longer has an "Automation" entry. (User testing of Phases 1-2 informs whether the existing Sessions tab is **renamed** to "Workflows", or "Workflows" becomes a separate top-level tab.)
- CONTEXT.md update: add the "Workflow" term to the Language section, with explicit `_Avoid_` lines covering Workflow ≠ Task (Task remains "one execution"), Workflow ≠ Trigger.
- This PRD is promoted to an ADR (or split into an ADR + an operations note).

**Acceptance criteria.**
1. No surviving in-app references to the old automation sub-pages outside legacy deep-link fallback.
2. CONTEXT.md vocabulary is consistent; the new Workflow term doesn't collide with existing terms.
3. The promote-in-place flow takes ≤4 taps from "I'm in this Session" to "this is now nightly".

### Sequence with ADR-0022

ADR-0022 Phase 3b (CLI fetches AgentLoop definitions from server on daemon boot, generic loops become server-visible) is **not a blocker** for this PRD's Phase 1 or Phase 2 — but it does affect Phase 1 fidelity (criterion 6: generic loops are flagged as CLI-local). Ideally ADR-0022 Phase 3b lands before this PRD's Phase 3, so Workflow list has 100% coverage.

If ADR-0022 Phase 3b is delayed: this PRD ships as-is with the "CLI-local" indicator. The indicator becomes a no-op once Phase 3b lands.

---

## 7. Migration & backward compatibility

| Surface | Option A | Option B | Option C |
|---|---|---|---|
| Wire schema | Additive RPC | Additive RPC + optional denormalized field | Breaking (new entity) |
| Server DB | None | None | New table + 3 FKs + migration |
| Old App clients | Work unchanged | Work unchanged (don't see Workflow grouping) | Broken until updated |
| Old CLI clients | Work unchanged | Work unchanged | Work but report into legacy schema; server bridges |
| Rollback | Stop using the new menu | Hide the new list | Multi-week unwind |
| Coexists with ADR-0022 | yes (no schema changes) | yes (additive only) | risky (overlapping schema migrations) |

For Option B (the recommendation): the entire change is **additive on the wire** and **deriving on the App**. A v0 App still in the field would simply not show the Workflow grouping — it would render Sessions as today. CLI / Agent / Server don't need coordinated releases.

---

## 8. Open questions

1. **Naming.** "Workflow" is generic. Alternatives: "Job", "Plan", "Routine", "Pipeline", "Run". Validate the name with 3-5 users before committing.
2. **Top-level tab.** Should the existing "Sessions" tab be renamed "Workflows"? Or should "Workflows" be a new top-level tab alongside Sessions? (Phase 3 decision.)
3. **Per-Project Workflows.** Is a Workflow inherently scoped to one Project, or can it span Projects on the same Machine? (Tasks today are Project-scoped via the Trigger; Sessions can be in any directory.)
4. **Ad-hoc Workflow lifetime.** When does an Ad-hoc Workflow disappear from the list? Same trigger as Session archival, or a separate timeline?
5. **Workflow Definition vs Workflow Run.** Should there be an explicit distinction in the UI? Temporal makes this distinction; Zapier does not. Phase 1 punts: a Workflow row aggregates all its runs. Phase 2+ may need a per-Run view if Loop iterations get long.
6. **Visibility of legacy concepts.** Do power users keep an "Advanced" view that shows raw Tasks / Triggers / Loops? Or are those fully hidden behind Workflow?
7. **Multi-trigger Workflows.** Pipedream supports it (one Workflow, many Triggers). Happy's data model would need a join table. Not in scope for this PRD; flag for Option C considerations.
8. **Wire performance.** Will server denormalize `Session.automationProvenance` (Option B optional field) help enough to be worth wire churn? Decide after Phase 1 measurement.

---

## Appendix A — Current state evidence

Source: code investigation (paths and line numbers as cited).

### A1. Task — capabilities and gaps

- Fields: `packages/happy-server/prisma/schema.prisma:927-987`. Status state machine `queued → dispatching → running → completed | failed | cancelled`. Has `parentTaskId` for nesting, `worktreeIsolation` for git isolation (wire 0.17.0), `triggerType ∈ {manual, cron, webhook}` + `triggerRef` to identify owner.
- Task ↔ Session: 1 Task → 0..1 Session (`Task.sessionId` set by CLI after spawn). Session lifecycle is independent of Task — a Session survives after its Task completes, available for user interaction.
- App UI: `packages/happy-app/sources/app/(app)/machine/[id]/tasks.tsx` — Kanban board by status.
- Lifecycle operations: cancel (`taskRoutes.ts:305-493`), retry (failed → queued; `attempt++`). **Pause is not supported**. Fork is a Session-level operation (`forkedFromSessionId`), not Task-level. Nesting via `parentTaskId` is fully wired but has no UI.

### A2. AgentLoop — current shape and the ADR-0022 transition

- Schema: `packages/happy-server/prisma/schema.prisma:538-643`. `role: supervisor | generic` discriminator, default `supervisor`. Phase 3a has landed: 10 generic-role columns (`prompt`, `directory`, `agent`, `intervalMs`, `cronExpression`, `enabled`, `nextRunAt`, `continuityKey`, `iteration`, `genericConfig`) present but only populated for `role = supervisor` today. Phase 3b (CLI fetches definitions from server) **not landed**.
- Generic-role AgentLoops today live in `.happy/agent-loops/*.json` files (CLI-local), invisible to the server. The CLI-side `AgentLoopBootstrapStore` reads/writes them.
- Supervisor-role AgentLoops are fully server-visible; the App's `/machine/[id]/loops.tsx` and `/project/[id]/supervisor-settings.tsx` cover them.
- Session reuse rule: `continuityKey`-matched (CLI side) or per-iteration new Session (supervisor side, where each iteration is one SupervisorRun).
- Creation paths today: server API (`/v1/supervisor-loops POST`), auto-discovery (`Project.autoLoopHealthThreshold` triggers auto-create after a high-scoring SupervisorRun), CLI bootstrap (Phase 3b-pending).

### A3. Trigger — fire-and-forget pattern

- Schemas: `packages/happy-server/prisma/schema.prisma:1044-1112`. `TriggerSchedule` (cron) and `WebhookTrigger` (event) share most fields; differ in trigger condition.
- Fire path (cron): every 5 min server heartbeat → `triggerScheduleRunner.ts:32-175` → `claimRepeatKey` (optimistic lock) → create Task with `triggerType="cron"`, `triggerRef=triggerScheduleId` → `emitSyncEphemeral(task-trigger)` → CLI Daemon spawns / resumes Session via GuardianSessionRegistry.
- Fire path (webhook): `POST /v1/triggers/:slug` with Bearer token → constant-time secret verification → template substitute `{{payload}}` → create Task with `triggerType="webhook"` → same daemon path.
- **Triggers cannot fire into an existing Session.** They always create a new Task; the Task fires the CLI; the CLI consults GuardianSessionRegistry; the registry either knows a Session id (resume) or doesn't (spawn fresh).
- Trigger CRUD UI is per-Machine: `/machine/[id]/trigger-schedule/*`, `/machine/[id]/webhook-trigger/*`. No project-level or top-level Trigger management surface.

### A4. UI — automation surfaces are fragmented and machine-centric

Five automation sub-pages under each Machine (`/machine/[id]/...`):

- `automation` (73 KB) — combined dashboard, jobs / guardians / audit timeline / filter
- `tasks` — Kanban
- `loops` (45 KB) — AgentLoop / SupervisorLoop list + brief preview + history
- `trigger-schedule/*` — cron Triggers CRUD
- `webhook-trigger/*` — webhook Triggers CRUD

Plus modals: `LoopEditorModal` (54 KB), `BootstrapProfileEditorModal` (17 KB), `OneClickSetupCard` (22 KB), `SkillPickerModal`, `DetailSheet` (14 KB).

There is no top-level Automation surface. Project pages cover Supervisor settings only.

### A5. Code-implemented but UI-invisible capabilities

| Capability | Source of truth | UI today |
|---|---|---|
| Task nesting | `schema.prisma:970-972`, `taskRoutes.ts:117, 199` | none — API-only |
| Generic AgentLoop role | `schema.prisma:548-580` (Phase 3a) | none — CLI-local, server-blind |
| AgentLoop cascade (`downstreamLoopIds`) | inside `AgentLoop.genericConfig` JSON | none |
| Session fork (`forkedFromSessionId`) | `schema.prisma:153`, `sessionRoutes.ts:735-747` | none |
| Knowledge supersession | `schema.prisma:799-851` | none — Knowledge has no top-level UI |
| TaskSkillBinding order | `schema.prisma:1027-1038` | none (skills picked but not orderable) |
| `Project.autoLoopHealthThreshold` | `schema.prisma:467-469` | none — config-only |
| Worktree isolation | `schema.prisma:960-961` (wire 0.17.0) | partial — create-only, not editable |

### A6. The "adopt" gap (confirmed)

- `GuardianSessionRegistry.remember(sessionId)` only accepts Sessions the dispatcher itself just created. There is no `attach(existingSessionId, key)` method anywhere.
- Loops, Supervisors, and Triggers all resolve Sessions through the registry. A Session the registry doesn't know about is invisible to them.
- The wire schema's `AutomationGuardianSummary.attached: boolean` is defined but no producer or consumer reads it — design left an empty seat.
- Minimum backend work to enable "adopt a manual Session": new RPC `sessionAdoptToLoop`, `GuardianSessionRegistry.attach()`, server-side `automationContext` mutation hook, `SyncUpdate` emit. Estimated 2 days (1 day CLI/Server, 1 day wire/test).

---

## Appendix B — Competitive landscape

Five products surveyed in depth (full report archived alongside this PRD).

### B1. n8n (workflow automation, OSS)

- IA: Workflow (top-level) → [Trigger + Steps] → Executions.
- Triggers: 8 types — Manual, Schedule, Webhook, App, Form, Chat, Error, Workflow-Linking.
- Promote path: explicitly swap a Manual Trigger node for a Schedule / Webhook node, then "Activate" the Workflow.
- IA philosophy: **Trigger-decision separation.** Trigger choice decides automation behavior; Steps stay independent. Same Workflow can be Manual or Auto by Trigger swap.

### B2. Zapier (SaaS automation, mass-market)

- IA: Zap → [1 Trigger + filters + actions] → Task History.
- Triggers: Polling vs Instant; no "manual run" concept by design.
- Promote path: there isn't one. Zaps are born automated. "Test record" exists but doesn't graduate to a Zap.
- IA philosophy: **Default-automated linear flow.** Manual is a non-concept.

### B3. Pipedream (developer-facing automation)

- IA: Workflow → [Multiple Triggers | Steps] → Execution History.
- Distinctive: **a single Workflow can have multiple Triggers** (any fires it).
- Promote path: "Run Now" is a test affordance, not a way to capture-and-schedule.
- IA philosophy: **Code-first multi-trigger.** Event sources are decoupled from logic; logic is code.

### B4. Temporal (workflow orchestration, developer)

- IA: Workflow Definition → Workflow Type → Workflow Execution → Event History.
- Distinctive: **Replay** — Event History is the source of truth; recoveries replay from the start, skipping completed Activities.
- Promote path: N/A — Temporal isn't a UI product; workflows are code.
- IA philosophy: **Deterministic replay via event sourcing.** Designed for very long, very reliable workflows.

### B5. GitHub Actions (CI/CD)

- IA: Workflow (YAML) → [Trigger] → Jobs → Steps.
- Triggers: 20+ types, declared in `on:` field. `workflow_dispatch` for manual UI button, `schedule` for cron, GitHub activity events for repo state.
- Promote path: edit the YAML's `on:` field. No UI wizard.
- IA philosophy: **Declarative event-driven.** Workflow-as-code is the contract.

### B6. Honorable mentions

- **Cursor Cloud Automations** (2025) — Tasks can be run manually or scheduled to repeat. Same Task Definition; one UI surface. **Closest pattern to Happy's Option B.**
- **Linear Automation Rules** — promote a manual workflow to a rule by editing the trigger condition.
- **Apple Shortcuts** — Personal Automations let you bind a Shortcut to a trigger (time, location, NFC tag). Conceptually closest to "promote-in-place" for end users.

### B7. IA pattern summary and Happy's fit

| Pattern | Representative | Happy fit |
|---|---|---|
| Trigger-decision separation | n8n, Pipedream | **Best fit for Option B.** Trigger is the pivot; Session is the "step" (single rather than node graph). |
| Default-automated linear flow | Zapier | Wrong philosophy. Happy's manual conversations are first-class. |
| Multi-trigger workflow | Pipedream | Phase 4+ direction; not first cut. |
| Workflow-as-code | GitHub Actions | Wrong philosophy. Happy users converse; they don't write YAML. |
| Event-sourced replay | Temporal | Architecturally orthogonal; possible future for SupervisorLoop replay UX. |
| Renaissance: task → schedule | Cursor, Linear, Shortcuts | **Validates promote-in-place as a recognized pattern.** |

---

## Appendix C — UI sketches (Option B)

### C1. Sessions list (now Workflow list)

```
┌──────────────────────────────────────────────────────────┐
│ ☰ Workflows                                          + ✚ │
│ ──────────────────────────────────────────────────────── │
│ ● Connected · 12 workflows · 7 active                    │
│                                                          │
│ [All]  [Ad-hoc]  [Scheduled]  [Event]  [Loop]      ⏶    │
│ ──────────────────────────────────────────────────────── │
│                                                          │
│ ▼  💬  Fix flaky test in api/auth.test.ts         15m   │
│      Ad-hoc · HomeMac · ~/proj/api                       │
│      ● Running · 2.1k tokens                             │
│                                                          │
│ ▶  🔁  Nightly knowledge consolidation            now    │
│      Loop · HomeMac · ~/proj/api                         │
│      ● Running iter 47/∞ · last fire 2h ago              │
│      └─ 3 sessions (tap to expand)                       │
│                                                          │
│ ▶  ⏱  PR auto-review                              2h    │
│      Scheduled · cron */15 * * * *  ·  WorkMac           │
│      ○ Idle · next fire in 8m · 142 runs                 │
│      └─ 142 sessions (tap to expand)                     │
│                                                          │
│ ▶  ⚡  GitHub webhook: build failure              4h    │
│      Event-driven · WorkMac · ~/proj/api                 │
│      ○ Idle · 17 fires this week                         │
│                                                          │
│ ▶  💬  Investigate token usage spike              2d    │
│      Ad-hoc · HomeMac · ~/proj/api                       │
│      ○ Archived                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
                              [💬] [📥] [🚀] [⚙]
```

Notes:
- Filter chip row replaces the per-machine automation chips already shipped.
- `▼` collapses; `▶` expands inline to show child Sessions.
- Kind icons: `💬` Ad-hoc, `🔁` Loop, `⏱` Scheduled, `⚡` Event.
- Status dot color uses the same palette as today's `SessionItem`.

### C2. Workflow detail (Ad-hoc, the simplest case)

```
┌──────────────────────────────────────────────────────────┐
│ ←   💬 Ad-hoc workflow                              ⋯    │
│ ──────────────────────────────────────────────────────── │
│   Fix flaky test in api/auth.test.ts                     │
│   HomeMac · ~/proj/api · started 15m ago                 │
│   ● Running · 2.1k tokens                                │
│                                                          │
│   Session                                                │
│   ┌──────────────────────────────────────────────────┐   │
│   │ 💬 Fix flaky test in api/auth.test.ts            │   │
│   │    last activity 2s ago                          │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │ 🚀 Make this recurring                           │   │
│   │ 🔁 Promote to Loop                               │   │
│   │ 🔗 Attach to existing Loop                       │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### C3. Workflow detail (Loop, the busiest case)

```
┌──────────────────────────────────────────────────────────┐
│ ←   🔁 Nightly knowledge consolidation              ⋯    │
│ ──────────────────────────────────────────────────────── │
│   Loop · HomeMac · ~/proj/api · agent: claude            │
│   ● Running iter 47/∞ · last fire 2h ago                 │
│   Continuity key: kc:agent-loop:abc12                    │
│                                                          │
│   Triggers                                               │
│   • cron 0 2 * * *  (every day 02:00)                    │
│   • watch ~/proj/api/CHANGELOG.md                        │
│                                                          │
│   Recent runs                                            │
│   ┌──────────────────────────────────────────────────┐   │
│   │ #47  2h ago    ✓ completed     12.4k tokens     │   │
│   │ #46  1d ago    ✓ completed     11.8k tokens     │   │
│   │ #45  2d ago    ✗ failed         (see logs)      │   │
│   │ #44  3d ago    ✓ completed     10.2k tokens     │   │
│   │ … 43 more                                        │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   Active Sessions                                        │
│   • Session "Auto-consolidate iter 47"   ⌃ (active)      │
│                                                          │
│   Configuration                                          │
│   prompt: "Consolidate knowledge from recent…"  [Edit]   │
│   interval: 24h · max iters: ∞ · cost cap: $5/run        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### C4. Promote modal (the magic moment)

```
┌──────────────────────────────────────────────────────────┐
│            🚀 Make this recurring                        │
│ ──────────────────────────────────────────────────────── │
│   Run this conversation on a schedule                    │
│                                                          │
│   Schedule                                               │
│   ( ) Every hour                                         │
│   ( ) Every day at  [02:00 ▾]                            │
│   ( ) Every week on [Monday ▾] at [09:00 ▾]              │
│   (●) Custom cron   [0 2 * * *           ]               │
│                                                          │
│   Reuse this Session                                     │
│   [✓] Continue the same Session each run                 │
│       (Guardian will resume Session id sess_abc12)       │
│                                                          │
│   Initial prompt for each run                            │
│   ┌──────────────────────────────────────────────────┐   │
│   │ Check api/auth.test.ts for flakiness…            │   │
│   │ (prefilled from last user message)               │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│                            [Cancel]  [Create]            │
└──────────────────────────────────────────────────────────┘
```

### C5. Empty / edge states

```
EMPTY WORKFLOWS LIST            ORPHAN SESSION (Loop ref lost)
┌─────────────────────────┐    ┌──────────────────────────┐
│ No workflows yet         │    │ ⚠ Loop reference orphan │
│                          │    │   This Session points    │
│ Run `happy` on your      │    │   to a Loop that no      │
│ Machine to start a       │    │   longer exists.         │
│ conversation, or         │    │   [Demote to Ad-hoc]     │
│ create a Schedule.       │    └──────────────────────────┘
│                          │
│   [+ New Schedule]       │    CLI-LOCAL LOOP (Phase 3b pre-land)
│   [+ New Webhook]        │    ┌──────────────────────────┐
└─────────────────────────┘    │ 🔁 generic loop (CLI)    │
                                │   This Loop runs locally │
                                │   on HomeMac. Some       │
                                │   actions are limited    │
                                │   until daemon reports.  │
                                └──────────────────────────┘
```

---

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-06-13 | Initial draft (Options A/B/C, Appendix A from code investigation, Appendix B from competitive research) | Claude (under direction) |
| 2026-06-13 | Status → ACCEPTED. Phases 1–3 implemented in a single session per "按顺序一次性开发完" directive. Workflow term added to CONTEXT.md. Make-recurring action shipped; loop adopt actions stubbed pending ADR-0022 phase 3b. | Claude (under direction) |
