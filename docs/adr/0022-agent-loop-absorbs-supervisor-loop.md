---
status: completed
---

# SupervisorLoop becomes an AgentLoop role; AgentLoop is the single persistent-autonomy primitive

> **Status — June 2026.** All four migration phases have landed. The
> `model AgentLoop` Prisma surface is canonical, the physical table is
> named `AgentLoop`, the `/v1/projects/:id/agent-loops` REST family
> handles both roles via the `role` query parameter, and the
> CLI-local `~/.happy/agent-loops.json` migration tooling
> (`happy loop migrate-preview`) is in place. Legacy
> `/v1/projects/:id/supervisor/loop*` routes are preserved as
> compatibility shims; new code targets the unified family.

Two parallel "loop" entities had accumulated in the codebase:

- **AgentLoop** — CLI-local, machine/directory-bound, generic persistent agent over a prompt + working memory, with cron/file/CI/webhook trigger bridges, `/brief` reporting, Auto-Dream memory consolidation, and downstream cascade. Defined in `packages/happy-cli/src/automation/AgentLoopCoordinator.ts` (~43KB) and 20+ neighbouring files. Definitions are stored CLI-local under `.happy/agent-loops/`; status is reported up via `DaemonState.automation.loopRollup`.
- **SupervisorLoop** — server-side Prisma model (`schema.prisma:511`), project-bound, multi-iteration `analyze → fix → re-analyze` autopilot over SupervisorRun → SupervisorAction with confidence-gated auto-approval. Engine in `supervisorLoopEngine.ts`. 158 cross-package references; dedicated routes (`supervisorLoopRoutes.ts`), UI screen (`/project/[id]/supervisor-loop/[loopId]`).

Externally — and especially in Claude Code's own `feature('KAIROS')` / `feature('AUTO-DREAM')` / `feature('DAEMON')` framing — these are the **same kind of thing**: a persistent agent that triggers on signals, accumulates working memory, reports briefs, and runs against a defined goal. Happy's AgentLoop already covers ~90% of KAIROS surface (cron, GitHub webhook bridge, notification channels, push, `/brief`, Auto-Dream). SupervisorLoop covers ~10% of it but adds two genuine specializations: structured `SupervisorAction` findings, and `healthScoreTarget` / `autoApproveThreshold` exit semantics.

Continuing to evolve the two in parallel would mean re-implementing every KAIROS capability twice and explaining to every new contributor why we have two "loops".

## Decision

**One persistent-autonomy primitive: AgentLoop.** SupervisorLoop is re-expressed as an AgentLoop with `role: "supervisor"`. The supervisor-role specialization owns its existing artefacts:

- **Outputs**: SupervisorRun (per-iteration analysis result) and SupervisorAction (individual finding) remain first-class domain entities. They are now scoped to "AgentLoops with role=supervisor", not to a separate SupervisorLoop entity.
- **Exit semantics**: `healthScoreTarget`, `autoApproveThreshold`, `maxConsecutiveFailures`, `costCapUsd` stay — they become **role-specific** AgentLoop config fields, gated by `role === "supervisor"`.
- **Frozen-at-start config**: the existing SupervisorLoop invariant ("Config snapshot frozen at loop start") survives as a per-role policy on AgentLoop.

**Definitions live on the server. Execution lives on the CLI daemon.** This is SupervisorLoop's current pattern and the right pattern for KAIROS-style 24/7: server-side cron can fire even when the daemon has been offline for hours, definitions sync across multiple App clients, and accumulating metrics (cost, iterations, healthScore) survive daemon restarts. The CLI daemon stops being the source of truth for AgentLoop definitions; it becomes a pure executor that reports `DaemonState.automation.loopRollup` for low-latency UI. Migration of existing CLI-local AgentLoops to the server is a downstream concern (see Phase 3 below).

**Role registry, not free-form strings.** `role` is one of `generic` (the default — today's AgentLoop) or `supervisor` (today's SupervisorLoop). New roles must be added explicitly. This bounds the surface and keeps role-specific config from drifting into untyped JSON blobs.

## Migration roadmap

The decision is accepted; only the migration is staged. Each phase is independently shippable.

**Phase 1 — Naming + documentation (this ADR). ✓ closed.** `CONTEXT.md` gained an `AgentLoop` entry; `SupervisorLoop` entry rewritten as "now a role on AgentLoop". No code change. Code kept both names; convergence signalled in docs first.

**Phase 2 — `role` discriminator on the server. ✓ closed.** Renamed the Prisma model `SupervisorLoop` → `AgentLoop` and added `@@map("SupervisorLoop")` so the physical table name was unchanged in DB. Added column `role TEXT NOT NULL DEFAULT 'supervisor'` so existing rows backfilled automatically. The supervisor engine (`supervisorLoopEngine.ts`) and supervisor routes (`supervisorLoopRoutes.ts`) switched from `db.supervisorLoop.*` to `db.agentLoop.*`, with `where: { role: "supervisor" }` added to every range query and mutation so a supervisor mutation could not accidentally touch a future generic-role row. The CLI-side AgentLoop pipeline (Phase 3b) writes to the same table with `role = "generic"`. The view-over-table approach the first revision of this ADR considered was abandoned — see Considered alternatives below.

**Phase 3a — Schema augmentation. ✓ closed.** Added 10 columns to `AgentLoop` for generic-role configuration: `prompt`, `directory`, `agent`, `intervalMs`, `cronExpression`, `enabled` (default true), `nextRunAt` (BigInt), `continuityKey`, `iteration` (default 0), `genericConfig Json?` (a JSON bag for the long-tail config — environment variables, file/github/ci bridge toggles, event filters, downstream cascade, notification channels, cost caps, CLI-side agent role triplet, etc.). All nullable except `enabled` and `iteration`, so supervisor-role rows are unaffected. Added composite index `(role, enabled, nextRunAt)` to support the scheduler's hot path. The CLI-side `roleId/roleName/roleType` triplet (user-defined agent persona) lives inside `genericConfig` to avoid colliding with the top-level `role` discriminator.

**Phase 3b — CLI definitions move to the server. ✓ closed.** Three coordinated landings:
- **Wire 0.32.0** (commit `12aabaf8c`): `SerializedAgentLoopSchema`, `CreateGenericAgentLoopBodySchema`, `UpdateGenericAgentLoopBodySchema`, `ListAgentLoopsQuerySchema`, the three `AgentLoop{Trigger,Status,Brief}EphemeralSchema` variants, persistent `AgentLoop{Update,Delete}SyncBodySchema`, and `AgentLoopIterationReportSchema`.
- **Server side** (commit `cbfeb7d88`): `agentLoopEngine.ts` (create/update/delete + `tickDueGenericAgentLoops` scheduler hooked into machine heartbeat 5-min throttle + iteration callback handler with stateless HMAC token), `agentLoopRoutes.ts` (`POST/GET/PATCH/DELETE/enable/disable/iterations` REST surface), syncEphemeral/syncUpdate seam extensions for the new variants.
- **CLI side** (commit `b453efb4f`): `RemoteAgentLoopController` translates `agent-loop-trigger` ephemerals into the existing `AgentLoopTriggerData` pipeline through `AutomationScheduler`; new `onJobTerminal` hook on the scheduler fires the HTTP iteration callback when the spawned session ends. CLI-local `~/.happy/agent-loops.json` keeps its runtime fields (iteration, nextRunAt, recentEvents, runtimeState, phase); the definition fields are now authoritative server-side.
- **Migration tool** (commit `486a08c98`): `migrateLocalAgentLoops` core + `happy loop migrate-preview` CLI subcommand. Idempotent (skip rows already marked `migratedToServerLoopId`), non-destructive (local row stays, just gains the marker), dry-run by default. Apply path lands once server deploy is verified.
- **App side** (commit `d4a763d50`): `apiAgentLoops.ts` HTTP client + `notifyAgentLoopsChanged` event bus, `CreateLoopModal` real form (machine → project → schedule chips → agent chips → prompt + optional name), `useWorkflows` merges server-fetched loops with `daemonState.automation.loops` (daemon-state wins on collision; server-fetch surfaces newly-created loops before daemon push arrives).

**Phase 4 — Routes + table + UI converge. ✓ closed.** Three coordinated landings:
- **Route unification** (commit `525ed85b4`, Batch 6): `/v1/projects/:id/agent-loops` family handles BOTH roles. `GET` list returns both when `role` query param is omitted; `DELETE` is role-aware (supervisor refuses running/paused, generic uses engine helper); `POST /{pause,resume,stop}` dispatches by role (supervisor → `supervisorLoopEngine`, generic → new `pauseGenericAgentLoop` / `resumeGenericAgentLoop` / `stopGenericAgentLoop` helpers). Legacy `/v1/projects/:id/supervisor/loop*` routes preserved as compatibility shims.
- **Physical table rename** (same commit, Batch 7): migration `20260614_phase4_rename_supervisorloop_to_agentloop` renames the table + 6 indexes + the projectId FK constraint. `@@map("SupervisorLoop")` alias dropped from `schema.prisma`. FKs INTO the table (`SupervisorRun.loopId`) keep their names automatically. One raw-SQL site in `projectDedup.ts` updated.
- **UI consolidation** (commit `d7c7378b9`, Batch 8): `useWorkflows` fetches both roles from the unified endpoint; `LoopWorkflow` gains a `role` discriminator; workflow list renders an inline "Supervisor" badge alongside the existing CLI-local tag. 17 new integration tests (`agentLoopRoutes.spec.ts`) pin the unified surface end-to-end with hoisted Prisma/inTx/sync/supervisor-engine fakes.

## Subordinate questions — status snapshot

- **Cron-trigger ownership. ✓ Settled (Phase 3b).** Server owns the schedule. `tickDueGenericAgentLoops` runs on the same machine-heartbeat 5-min throttle as the supervisor scheduler and uses the Phase 3a `(role, enabled, nextRunAt)` composite index. CLI keeps local fallback for offline operation in the legacy `~/.happy/agent-loops.json` path, but once a loop is server-managed the server is authoritative. Daemon offline ≠ schedule skipped — the next heartbeat dequeues every overdue iteration.
- **`autoApproveThreshold` for generic role.** Open — generic still uses a binary autoRun. A future ADR may extend confidence-gated approval across roles once the use case surfaces.
- **Backwards-compatible API window.** Settled as part of Phase 4: `/v1/projects/:id/supervisor/loop*` routes stay alive indefinitely as compatibility shims. Deprecation timeline is non-urgent — new code targets the unified family; old surface keeps working until a follow-up ADR formally retires it.

## Considered alternatives

- **Parallel evolution (option B in the design discussion).** Keep SupervisorLoop independent; port AgentLoop's KAIROS-equivalent capabilities (notification channels, push, `/brief`, Auto-Dream memory, webhook→loop bridges) into SupervisorLoop one-by-one. Rejected: same surface implemented twice, every new KAIROS capability costs 2× the work forever, and the conceptual confusion ("why are there two loops?") never resolves. Cheaper short-term, much more expensive long-term.
- **Shared `LoopRuntime` base (option C).** Extract a third abstraction both AgentLoop and SupervisorLoop build on. Rejected for now: a base layer with two consumers is hard to design well; the two-consumer case is the textbook "abstraction shaped for the wrong axis" risk that ADR-0009 warns against. Revisit only if a third loop kind appears (e.g. a `role: "research"`).
- **Keep both names, declare them aliases.** Rejected: "AgentLoop" and "SupervisorLoop" describe genuinely different shapes today (CLI-local generic vs. server-side supervisor autopilot). An alias would paper over the data + execution-locality difference and re-create the confusion at the implementation layer.
- **Phase 2 via Prisma view (first revision).** This ADR originally proposed `model SupervisorLoop` becoming a database view filtered on `role = "supervisor"`. Rejected on investigation: Prisma 7 views are a preview feature (not enabled in this project, only `relationJoins` is), and even when enabled they are **read-only** — `supervisorLoopEngine.ts` has 28 calls that include `update` / `updateMany` / `create` / `delete` / `deleteMany`, none of which compile against a Prisma view. A view target also cannot be the destination of a foreign key, so `SupervisorRun.loopId → SupervisorLoop.id` would break. The `@@map` + `role` approach (Phase 2 above) achieves the same outcome cheaper: zero data migration (column default backfills existing rows), zero FK breakage, and a one-shot search-and-replace in the two server files.

## Consequences

- New contributors learn one persistent-autonomy primitive (AgentLoop), not two. Claude Code's KAIROS framing maps to it directly.
- The `SupervisorLoop` name is fully retired at the model + table + canonical route level. The only remaining traces are the legacy `/v1/projects/:id/supervisor/loop*` HTTP routes (kept as compatibility shims), the `SupervisorRun` and `SupervisorAction` tables (which are the supervisor-role *outputs* and remain first-class), and the rich vocabulary `Supervisor` UI surface (settings, health charts, autopilot terminology) that is genuinely role-specific.
- The project domain's `Project → SupervisorRun` relationship now reads `Project → AgentLoop (role=supervisor) → SupervisorRun`. SupervisorRun and SupervisorAction semantics are unchanged.
- `CONTEXT.md` declares the converged model upfront; the legacy `SupervisorLoop` term is signposted as fully absorbed.
- A future architecture review that proposes "split SupervisorLoop back out because the supervisor autonomy needs differ", or asks "why does the generic AgentLoop carry healthScoreTarget?" (it doesn't — that field is role-gated) should read this ADR first.
- 105 server tests + 85 CLI automation tests + 657 app i18n audit tests pin the converged contract. The agentLoopRoutes integration spec covers role-aware list / detail / delete / pause / resume / stop / enable / disable / iteration callback end-to-end through hoisted Prisma/inTx/sync fakes.
