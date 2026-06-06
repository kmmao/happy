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
The single persistent-autonomy primitive — a long-running agent bound to a Machine + directory (and optionally a Project), executing a goal-driven prompt on cron, file-watch, CI, or webhook triggers, with working memory persisted across iterations, periodic `/brief` reports, Auto-Dream memory consolidation, and optional downstream cascade to other AgentLoops. Carries a `role` discriminator (`generic` or `supervisor`) that selects role-specific config and output shape. Per ADR-0022 SupervisorLoop is now the `role: "supervisor"` variant of AgentLoop; the standalone `SupervisorLoop` Prisma model exists during the migration window only.
_Avoid_: Supervisor (the role name only — the runtime is AgentLoop), Watcher, Daemon process (Daemon is the host)

**Supervisor**:
A `role` on AgentLoop that runs the analyze → fix → re-analyze autopilot on a Project. Not a single entity — an umbrella for the supervisor-role AgentLoop plus its outputs (SupervisorRun, SupervisorAction).
_Avoid_: Monitor, watcher, analyzer

**SupervisorRun**:
A single analysis/fix pass produced by a supervisor-role AgentLoop iteration (or a one-off trigger). Produces SupervisorActions (findings) and an optional Artifact (encrypted report). Triggered by schedule, manual request, event, or research.

**SupervisorLoop**:
The legacy name for the supervisor-role AgentLoop. Per ADR-0022, it is being absorbed: new work targets AgentLoop with `role: "supervisor"`; `model SupervisorLoop` survives only as a DB view during the migration. The autopilot semantics (analyze → fix → re-analyze until exit on max iterations, cost cap, health target, consecutive failures, user stop, or timeout) carry over unchanged as supervisor-role config on AgentLoop.

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

**Turn**:
One agent request→response cycle within a Session, bracketed by a `turn-start`/`turn-end` SessionEvent pair and carrying the ordered SessionEvents (text, tool calls, Subagent activity) produced in between. A Session is a sequence of Turns. The CLI assembles Turns from the underlying provider's stream (Claude JSONL, Codex, ACP) through a single Turn lifecycle reducer rather than per-provider hand-rolled state.
_Avoid_: Round, exchange, cycle (and do not confuse with the domain Task)

**Subagent**:
A nested agent spawned within a Turn (e.g. via Claude Code's Agent/Task tool or a local workflow), identified by a cuid2 carried on SessionEnvelopes. Its activity is bracketed by subagent start/stop SessionEvents scoped to the parent Turn; multiple Subagents can be active concurrently within one Turn, and any still active when the Turn ends are stopped with it.
_Avoid_: Child session, worker (and do not confuse with the domain Task, a server-dispatched automated work unit)

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

## Relationships

- An **Account** owns zero or more **Machines**, **Sessions**, **Projects**, and **AiBackendProfiles**
- A **Machine** belongs to exactly one **Account** and runs one **Daemon**
- A **Session** is bound to exactly one **Machine** and has exactly one **AccessKey**
- A **Session** contains ordered **SessionMessages** and **SessionEvents**
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
- **AgentLoop ↔ SupervisorLoop** convergence is in flight — see ADR-0022. Phase 2 has landed: `model AgentLoop` is the canonical Prisma model (`@@map("SupervisorLoop")` keeps the physical table name during the migration window), with a `role` discriminator (`supervisor` | `generic`). Every supervisor mutation filters by `role: "supervisor"` defensively. Phase 3a has landed: 10 columns for generic-role configuration (prompt, directory, agent, intervalMs, cronExpression, enabled, nextRunAt, continuityKey, iteration, genericConfig Json) are present but NOT yet populated — the CLI-local `.happy/agent-loops/` pipeline still owns them. Phase 3b (CLI fetches AgentLoop definitions from server on daemon boot) is the next milestone. Until then, treat code that still says "SupervisorLoop" as legacy unless it's inside the supervisor-role specialization (output shape: SupervisorRun + SupervisorAction).
- **Preview** traffic is not E2E encrypted (HTTP proxy needs plaintext for the browser); all other Session content remains E2E — see ADR-0001 and ADR-0007.
- **VisualAnnotation** currently travels as a markdown SessionMessage with a fenced JSON block; migrating to `visual_annotation_reference` inputBlock — see ADR-0007.

