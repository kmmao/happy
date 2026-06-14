# Happy Coder

A mobile/web client system for remotely controlling Claude Code and Codex with end-to-end encryption. Accounts run `happy` on their computer, then control sessions from phone/web.

## Language

**Account**:
A person registered in Happy, the root entity owning all resources (Machines, Sessions, Projects, Friends).
_Avoid_: User, client

**Machine**:
A physical or virtual computer running the Happy CLI daemon, owned by an Account.
_Avoid_: Device, host, node

**Session**:
A Claude conversation bound to a specific Machine, plus all attached state (messages, progress, preferences, agent state). 1:1 with a Claude Code native session, extended with remote control and E2E encryption.
_Avoid_: Chat, conversation, thread

**Task**:
An automated work unit with an encrypted prompt, dispatched to a Machine's CLI daemon. Created manually, by schedule (TriggerSchedule), or by webhook (WebhookTrigger). Follows a state machine: queued → dispatching → running → completed/failed/cancelled. Can nest (parent Task decomposes into child Steps).
_Avoid_: Job, command, request (and do not confuse with UI todo/checklist items)

**Project**:
A named codebase location on a specific Machine (`machineId:path`). Container for Knowledge, Skills, Supervisors, Triggers, and Tasks. Machine-scoped — the same git repo on two Machines produces two distinct Projects.
_Avoid_: Repo, workspace, codebase

**AccessKey**:
An E2E encryption bridge keyed by the triple (Account, Machine, Session). Carries encrypted ephemeral key material that lets the App decrypt Session content from the CLI. Exactly one per Session; created when the CLI starts a session, version-controlled via optimistic locking.
_Avoid_: Token, secret, credential

**Skill**:
A reusable instruction template (versioned content + optional attachments), global or Project-scoped. Injected into Tasks via TaskSkillBinding to guide AI behavior; injection order matters. Not to be confused with Claude Code agent skills (mattpocock/skills etc.).
_Avoid_: Prompt template, recipe, plugin

**AgentLoop**:
The single persistent-autonomy primitive — a long-running agent bound to a Machine + directory (and optionally a Project), executing a goal-driven prompt on cron, file-watch, CI, or webhook triggers, with working memory persisted across iterations, periodic `/brief` reports, Auto-Dream memory consolidation, and optional downstream cascade to other AgentLoops. Carries a `role` discriminator (`generic` or `supervisor`) that selects role-specific config and output shape. **Definitions live server-side** as of ADR-0022 Phase 3b — `AgentLoop` Prisma model + `/v1/projects/:id/agent-loops` REST family. The CLI daemon executes iterations triggered by `agent-loop-trigger` ephemerals and reports completion via HTTP iteration callback. SupervisorLoop is fully absorbed (Phase 4) — model + table both named `AgentLoop`; supervisor remains a `role` value, not a separate entity.
_Avoid_: Supervisor (the role name only — the runtime is AgentLoop), Watcher, Daemon process (Daemon is the host)

**Supervisor**:
A `role` on AgentLoop that runs the analyze → fix → re-analyze autopilot on a Project. Not a single entity — an umbrella for the supervisor-role AgentLoop plus its outputs (SupervisorRun, SupervisorAction).
_Avoid_: Monitor, watcher, analyzer

**SupervisorRun**:
A single analysis/fix pass produced by a supervisor-role AgentLoop iteration (or a one-off trigger). Produces SupervisorActions (findings) and an optional Artifact (encrypted report). Triggered by schedule, manual request, event, or research.

**SupervisorLoop**:
Legacy name. **Fully absorbed** — both the Prisma model and the physical Postgres table are now named `AgentLoop`; the `@@map("SupervisorLoop")` alias was dropped in ADR-0022 Phase 4 (migration `20260614_phase4_rename_supervisorloop_to_agentloop`). Supervisor-role rows still carry the autopilot semantics (analyze → fix → re-analyze until exit on max iterations, cost cap, health target, consecutive failures, user stop, or timeout) as `role: "supervisor"` config on AgentLoop. Old `/v1/projects/:id/supervisor/loop*` HTTP routes remain as compatibility shims; new code targets `/v1/projects/:id/agent-loops` with the `role` query parameter.

**SupervisorAction**:
An individual finding from a SupervisorRun — title, description, suggested fix, severity (critical/high/medium/low), category (security/dependencies/architecture/techDebt/codeQuality/testCoverage). Follows an approval workflow: pending → approved/skipped/ignored. Can spawn a fix Session.

**Knowledge**:
A learned fact stored in a Project. Types: discovery, decision, fix, convention, warning, repo_map, summary. Contributors: session (auto), supervisor (analysis), user (manual). Lifecycle: create → amend → supersede. Knowledge entries form a graph via KnowledgeRelation (related/contradicts/refines/combines). Code model name is `ProjectKnowledge`.
_Avoid_: Note, memo, insight

**Daemon**:
The persistent background process running on a Machine. Maintains Socket.IO connection to Server, receives and executes Tasks, manages local Claude Code/Codex processes, and reports DaemonState. Not an independent entity — the runtime form of a Machine.
_Avoid_: Agent, service, worker

**DaemonState**:
A real-time status snapshot of a Daemon, stored as an encrypted field on Machine. Contains daemon status, port, Tailscale/tunnel info, automation summaries, CLI install info, and recent errors.

**Preview**:
A live remote view of a local dev server from within a Session. Session-scoped — each Session has at most one active Preview. Consists of a PreviewCandidate (reported dev server) and an optional PreviewTunnel (active proxy connection). The Daemon proxies HTTP/WebSocket traffic between the App and the local server; the App renders the page in an iframe/WebView. Not an independent entity — an ephemeral capability of a Session.
_Avoid_: Remote desktop, screen share

**PreviewCandidate**:
A dev server reported by the Agent via the `report_preview` MCP tool. Records protocol, host, port, and optional metadata (devServerType, command, pid). Transitions through states: reported → available → invalid. Session-scoped and ephemeral (in-memory only).
_Avoid_: Preview target, preview source

**PreviewTunnel**:
An active proxy connection that makes a local dev server reachable through a public URL on the Server. Created by the Account from a PreviewCandidate. Traffic flows: App → Server (HTTP gateway) → Daemon (Socket.IO) → localhost. Includes WebSocket proxying for HMR. Subject to lease (8h) and idle timeout (45min). One per Session at most.
_Avoid_: Preview connection, proxy session

**VisualAnnotation**:
A UI feedback action within a Preview — the Account clicks an element, writes a comment, and sends structured data (CSS selector, XPath, computed style, ancestor chain) back to the Session as a message. The injected annotation runtime tracks element positions via MutationObserver so comment pins stay anchored across DOM changes.
_Avoid_: Screenshot annotation, markup

**SessionMessage**:
An immutable, encrypted message in a Session's conversation log. Seq-ordered for causal tracking, deduplicated by localId. The primary content stream users see in the App.
_Avoid_: Chat message, log entry

**SessionEvent**:
A lightweight timeline entry recording operations during a Session (file edits, bash commands, tool calls, errors). Plaintext summaries + structured JSON detail. Displayed in the App's timeline view for replay and audit.
_Avoid_: Log, activity

**SyncUpdate**:
A typed, seq-ordered server→client broadcast that delivers a change to a domain entity (Session, Machine, Account, Project, Artifact, Feed entry, KV) to all Account-owned connections that need to know. Wire shape is `UpdatePayload` (`{id, seq, body: {t, ...}}`); each `body.t` uniquely determines the recipient set (the App, the Session's CLI side, the Machine's Daemon, or some combination). Persistent per ADR-0013: clients dedupe by `id` and reconcile by `seq`, so a SyncUpdate emitted while a client is offline is recoverable from sync state on reconnect. Pairs symmetrically with **SyncEphemeral**; the two together cover every server→client broadcast.
_Avoid_: Notification, broadcast, event (collides with SessionEvent), message (collides with SessionMessage)

**SyncEphemeral**:
A typed, fire-and-forget server→client broadcast that signals a transient state change (activity ticks, terminal output, task triggers, supervisor progress, preview state, inter-agent fan-out, etc.) without persisting or reconciling. Wire shape is `EphemeralPayload` (`{type, ...}`); each variant's `type` (or seam-internal `t` discriminator) uniquely determines the recipient set. Per ADR-0013: no seq, no client-side dedup, no replay on reconnect — clients that miss a SyncEphemeral simply miss it. Pairs symmetrically with **SyncUpdate**; the SyncEphemeral seam lives in `app/events/syncEphemeral.ts` (per ADR-0024) and shares the `eventRouter` transport adapter and `RecipientFilter` taxonomy with SyncUpdate but not its seq / id / `afterTx` lifecycle.
_Avoid_: Notification (too generic), broadcast (too generic), Ephemeral on its own (it is a SyncEphemeral; "ephemeral" as an adjective is fine)

**SyncUpdateIngest**:
The App-side seam that consumes one **SyncUpdate** and produces (a) a set of storage mutations and (b) a set of typed ingest events for downstream subscribers. Symmetric to the server's `emitSyncUpdate` seam (ADR-0023): emit owns "what to broadcast and to whom"; ingest owns "what to mutate and what high-level events to fan out". Body discriminator `body.t` selects the per-variant handler via an exhaustive switch private to the seam; encryption-scope resolution (the startup-race / refetch-recovery invariant) is an internal seam shared across handlers; UI/feature side effects (voice cues, notifications, issue-session bookkeeping, terminal-signal dispatch, sync invalidations) live OUTSIDE the seam as subscribers of the ingest event stream.
_Avoid_: SyncUpdate handler (too narrow — the seam isn't just dispatch), Reducer (collides with `reducer.ts`, which folds message streams, not SyncUpdates), Apply (too generic)

**SyncEphemeralIngest**:
The App-side seam that consumes one **SyncEphemeral** and fans it out to typed subscribers. Parallel to **SyncUpdateIngest** and symmetric to the server's `emitSyncEphemeral` (ADR-0024). No storage mutations are required (ephemerals do not reconcile), so the output is a typed event stream only. Kept as its own seam from SyncUpdateIngest for the same reason ADR-0024 keeps `syncEphemeral.ts` separate from `syncUpdate.ts` — the lifecycle invariants the SyncUpdate ingest may grow (cursor advance, seq gap fill, post-mutation event ordering) do not apply to ephemerals.
_Avoid_: SyncEphemeral dispatcher (too narrow), Listener (too generic)

**Turn**:
One agent request→response cycle within a Session, bracketed by a `turn-start`/`turn-end` SessionEvent pair and carrying the ordered SessionEvents (text, tool calls, Subagent activity) produced in between. A Session is a sequence of Turns. The CLI assembles Turns from each **Provider**'s stream through a single Turn lifecycle reducer (`session-protocol/turnReducer.ts`); every Provider integrates via a **ProviderAdapter** rather than hand-rolling Turn or Subagent lifecycle (ADR-0025).
_Avoid_: Round, exchange, cycle (and do not confuse with the domain Task)

**Subagent**:
A nested agent spawned within a Turn (e.g. via Claude Code's Agent/Task tool or a local workflow), identified by a cuid2 carried on SessionEnvelopes. Its activity is bracketed by subagent start/stop SessionEvents scoped to the parent Turn; multiple Subagents can be active concurrently within one Turn, and any still active when the Turn ends are stopped with it. Each Provider's Subagent-identification rules live behind a resolver owned by that Provider's mapper (Claude: `claude/utils/subagentResolver.ts` — explicit parent id, parentUuid inheritance, prompt matching, buffering); the lifecycle invariants stay in `turnReducer` per ADR-0025.
_Avoid_: Child session, worker (and do not confuse with the domain Task, a server-dispatched automated work unit)

**Provider**:
A backend that produces the raw stream the CLI converts into SessionEnvelopes — today **Claude** (JSONL on disk), **Codex** (app-server stream), and **ACP** (interactive protocol). Each Provider has its own wire format and its own Subagent-identification rules; the **Turn lifecycle** (turn-start ordering, exactly-once Subagent start, auto-stop on turn-end) is identical across all three and lives in `session-protocol/turnReducer.ts`. Per ADR-0025, every Provider is integrated into that reducer through a **ProviderAdapter**: a type contract (`liftProtocol`/`writeProtocol`) that lifts the reducer's `ProtocolState` out of the Provider's larger per-stream state, calls `reduce`, and writes the result back. New Providers add an Adapter + signal-extraction code; they do not re-implement Turn or Subagent lifecycle.
_Avoid_: AI provider (collides with AiBackendProfile, which names the *model/profile* not the *stream format*), backend, adapter on its own

**Artifact**:
A generic encrypted data container (header + body) with its own encryption key. Used for Supervisor reports, research documents, and user-created content. Not related to Claude.ai's "Artifact" concept.
_Avoid_: Document, file, attachment

**Trigger**:
A rule that automatically creates Tasks. Umbrella term for TriggerSchedule and WebhookTrigger.

**TriggerSchedule**:
A cron-expression-driven Trigger that periodically creates Tasks.

**WebhookTrigger**:
An event-driven Trigger with a custom URL slug and secret verification. Fires on external events (e.g. GitHub push).

**AiBackendProfile**:
A named AI backend configuration owned by an Account. Encrypted payload containing environment variables, startup scripts, and permission mode. Bound to Tasks, Projects, or Triggers to select which model/provider to use.
_Avoid_: Profile, backend, config

**Workflow**:
The App-side IA primitive for "a thing the Account is asking Happy to do." A *view* over existing entities (not a database table) computed by `useWorkflows()`. Every Workflow has a kind:
- **Ad-hoc Workflow** — backed by a single manual Session (no Trigger, no AgentLoop). Created implicitly the moment the Account runs `happy`.
- **Scheduled Workflow** — centered on a `TriggerSchedule`; its Sessions are the Tasks-it-spawned-Sessions.
- **Event-driven Workflow** — centered on a `WebhookTrigger`.
- **Loop Workflow** — centered on an `AgentLoop` (either `role` variant); its Sessions are the loop's iteration Sessions, linked via `Session.metadata.automationContext.loopId`.

The Sessions tab in the App is the Workflow list. Sessions still exist as the atomic conversation unit; Workflow is the **grouping** under which the user sees them. See `docs/plans/sessions-and-automation-ia.md` (promoted to accepted on the Workflow-IA rollout).
_Avoid_: Job (collides with the Task state machine's internal terminology), Routine, Pipeline. Workflow is the user-facing word; Task is the per-execution row inside it.

## Relationships

- An **Account** owns zero or more **Machines**, **Sessions**, **Projects**, and **AiBackendProfiles**
- A **Machine** belongs to exactly one **Account** and runs one **Daemon**
- A **Session** is bound to exactly one **Machine** and has exactly one **AccessKey**
- A **Session** contains ordered **SessionMessages** and **SessionEvents**
- Every server-side mutation of a domain entity emits a **SyncUpdate**; its `body.t` determines which Account-owned connections receive it
- Every server-side transient-state signal emits a **SyncEphemeral**; its discriminator likewise determines the recipient set, but no client-side reconciliation applies
- A **Session** is a sequence of **Turns**; each **Turn** is assembled from one **Provider**'s stream via that Provider's **ProviderAdapter** + the shared Turn lifecycle reducer
- A **Session** is a sequence of **Turns**; a **Turn** contains ordered **SessionEvents** and zero or more concurrent **Subagents**, all bracketed by its turn-start/turn-end pair
- A **Project** lives on exactly one **Machine** at a specific path
- A **Project** contains **Knowledge**, **Skills**, **Triggers**, **AgentLoops**, and **SupervisorRuns**
- A **Task** is dispatched to a **Machine**, optionally within a **Project** context
- A **Task** can be created by an **Account** (manual), a **TriggerSchedule**, or a **WebhookTrigger**
- A **Task** binds one or more **Skills** via TaskSkillBinding (ordered)
- A **Task** can nest — a parent **Task** decomposes into child **Tasks** (Steps)
- An **AgentLoop** is bound to a **Machine** and a directory, optionally scoped to a **Project**; it carries a `role` (`generic` or `supervisor`)
- An **AgentLoop** with `role: "supervisor"` produces **SupervisorRuns** (the legacy **SupervisorLoop** is this case)
- An **AgentLoop** can cascade — completing or failing triggers downstream **AgentLoops** via `downstreamLoopIds`
- A **SupervisorRun** belongs to a **Project** and produces **SupervisorActions**; if it was produced inside an AgentLoop iteration, it also belongs to that **AgentLoop**
- A **SupervisorAction** can spawn a fix **Session**
- **Knowledge** entries relate to each other via KnowledgeRelation (related/contradicts/refines/combines)
- A **Trigger** belongs to a **Project** and references an **AiBackendProfile**
- A **Session** has at most one active **Preview** (0..1)
- A **Preview** has exactly one **PreviewCandidate** and at most one **PreviewTunnel**
- A **PreviewTunnel** is proxied through the **Daemon** on the Session's **Machine**
- A **VisualAnnotation** belongs to a **Preview** and produces a **SessionMessage**

## Example dialogue

> **Dev:** "A user wants to run a health check on their project every night. How does that work?"
> **Domain expert:** "They create a **TriggerSchedule** on the **Project** with a cron expression. Each fire creates a **Task** dispatched to the **Machine**'s **Daemon**. The **Task** runs a **SupervisorRun**, which produces **SupervisorActions**. If the **Account** has a **SupervisorLoop** configured, it keeps iterating — analyze, fix, re-analyze — until the exit condition is met."

> **Dev:** "How does the phone see what Claude is doing?"
> **Domain expert:** "The **Daemon** syncs **SessionMessages** and **SessionEvents** to the Server, encrypted with the **AccessKey**. The App fetches and decrypts them. **SessionMessages** show the conversation; **SessionEvents** show the operation timeline."

## Flagged ambiguities

- "User" appears in code model names (`UserRelationship`, `UserProfile`) but the canonical domain term is **Account**.
- "Skill" in Happy means a reusable instruction template for Tasks — not a Claude Code agent skill (mattpocock/skills).
- "Artifact" in Happy means an encrypted data container — not a Claude.ai conversation artifact.
- "Task" strictly means an automated work unit — not a UI todo/checklist item.
- **PreviewTunnel** authenticates browser access by tunnelId only — see ADR-0010.
- Code uses `PreviewConnection` / `preview-connection-updated` but the canonical domain term is **PreviewTunnel**. The wire schemas are already published under the old name; align in a future breaking version bump.
- **AgentLoop ↔ SupervisorLoop** convergence is COMPLETE — see ADR-0022. **Phase 2** (canonical `model AgentLoop` + `role` discriminator), **Phase 3a** (10 generic-role columns + scheduler composite index), **Phase 3b** (server-side CRUD + scheduler, CLI `agent-loop-trigger` handler + iteration HTTP callback, migration tool for CLI-local loops, App `CreateLoopModal` real form, `useWorkflows` merges server + daemon-state loops), and **Phase 4** (route unification — `/v1/projects/:id/agent-loops` family handles both roles via `role` query param with pause/resume/stop/delete role-dispatch; physical table renamed `SupervisorLoop` → `AgentLoop`, `@@map` alias dropped; UI consolidation — workflow list shows both roles with an inline `Supervisor` badge) have all landed. Legacy `/v1/projects/:id/supervisor/loop*` routes are preserved as compatibility shims; new code should target the unified `/agent-loops` family. CLI-local `~/.happy/agent-loops.json` is migrated to server-side rows via `happy loop migrate-preview` (apply path lands after server deploy verification). 105 server tests + 85 CLI automation tests + 657 app i18n tests pin the contract.
- **Preview** traffic is not E2E encrypted (HTTP proxy needs plaintext for the browser); all other Session content remains E2E — see ADR-0001 and ADR-0007.
- **VisualAnnotation** currently travels as a markdown SessionMessage with a fenced JSON block; migrating to `visual_annotation_reference` inputBlock — see ADR-0007.
- **SyncUpdate** is the domain term; the wire-level type is still named `UpdatePayload` and the Socket.IO event name is `update`. Align in a future breaking version bump of `@kmmao/happy-wire`. App-side code already uses "sync update" (`syncUpdateHandlers.ts`, `syncUpdateScope.ts`) — the server side adopts the same term via this seam.
- **SyncEphemeral** is the domain term; the wire-level type is still named `EphemeralPayload` and the Socket.IO event name is `ephemeral`. The same future wire bump will align the naming. The `inter-agent-message-deliver` and `inter-agent-message-echo` seam discriminators both wire-emit `type: "inter-agent-message"` (ADR-0024 decision E3); this is the one place where the seam's body discriminator deliberately differs from the wire `type`.

