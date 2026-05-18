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

**Supervisor**:
The automated health analysis system for Projects. Not a single entity — an umbrella term for SupervisorRun, SupervisorLoop, and SupervisorAction.
_Avoid_: Monitor, watcher, analyzer

**SupervisorRun**:
A single analysis/fix pass on a Project. Produces SupervisorActions (findings) and an optional Artifact (encrypted report). Triggered by schedule, manual request, event, or research.

**SupervisorLoop**:
A multi-iteration autopilot: analyze → fix → re-analyze until an exit condition is met (max iterations, cost cap, health target, consecutive failures, user stop, or timeout).

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

**SessionMessage**:
An immutable, encrypted message in a Session's conversation log. Seq-ordered for causal tracking, deduplicated by localId. The primary content stream users see in the App.
_Avoid_: Chat message, log entry

**SessionEvent**:
A lightweight timeline entry recording operations during a Session (file edits, bash commands, tool calls, errors). Plaintext summaries + structured JSON detail. Displayed in the App's timeline view for replay and audit.
_Avoid_: Log, activity

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
- A **Project** lives on exactly one **Machine** at a specific path
- A **Project** contains **Knowledge**, **Skills**, **Triggers**, and **SupervisorRuns**
- A **Task** is dispatched to a **Machine**, optionally within a **Project** context
- A **Task** can be created by an **Account** (manual), a **TriggerSchedule**, or a **WebhookTrigger**
- A **Task** binds one or more **Skills** via TaskSkillBinding (ordered)
- A **Task** can nest — a parent **Task** decomposes into child **Tasks** (Steps)
- A **SupervisorRun** belongs to a **Project** and produces **SupervisorActions**
- A **SupervisorLoop** orchestrates multiple **SupervisorRuns** on the same **Project**
- A **SupervisorAction** can spawn a fix **Session**
- **Knowledge** entries relate to each other via KnowledgeRelation (related/contradicts/refines/combines)
- A **Trigger** belongs to a **Project** and references an **AiBackendProfile**

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

