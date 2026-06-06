---
status: accepted
---

# SupervisorLoop becomes an AgentLoop role; AgentLoop is the single persistent-autonomy primitive

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

**Phase 1 — Naming + documentation (this ADR).** `CONTEXT.md` gains an `AgentLoop` entry; `SupervisorLoop` entry is rewritten as "now a role on AgentLoop per this ADR". No code change. Code keeps both names for now; the convergence is signalled in docs first.

**Phase 2 — `role` discriminator on the server.** Rename the Prisma model `SupervisorLoop` → `AgentLoop` and add `@@map("SupervisorLoop")` so the physical table name is unchanged in DB. Add a new column `role TEXT NOT NULL DEFAULT 'supervisor'` so existing rows backfill automatically. The supervisor engine (`supervisorLoopEngine.ts`) and supervisor routes (`supervisorLoopRoutes.ts`) switch from `db.supervisorLoop.*` to `db.agentLoop.*`, with `where: { role: "supervisor" }` added to every range query and mutation so a supervisor mutation can never accidentally touch a future generic-role row. The CLI-side AgentLoop pipeline (when it lands in Phase 3) writes to the same table with `role = "generic"`. The view-over-table approach the first revision of this ADR considered was abandoned — see Considered alternatives below.

**Phase 3a — Schema augmentation (landed).** Add 10 columns to `AgentLoop` for generic-role configuration: `prompt`, `directory`, `agent`, `intervalMs`, `cronExpression`, `enabled` (default true), `nextRunAt` (BigInt), `continuityKey`, `iteration` (default 0), `genericConfig Json?` (a JSON bag for the long-tail config — environment variables, file/github/ci bridge toggles, event filters, downstream cascade, notification channels, cost caps, CLI-side agent role triplet, etc.). All nullable except `enabled` and `iteration`, so supervisor-role rows are unaffected. New index `(role, enabled, nextRunAt)` supports the scheduler's hot path. The CLI-side `roleId/roleName/roleType` triplet (user-defined agent persona) lives inside `genericConfig` to avoid colliding with the top-level `role` discriminator.

**Phase 3b — CLI definitions move to the server.** CLI-local `.happy/agent-loops/<id>/` directories become **runtime artefacts only** (working memory, briefs, transcripts). The definition (prompt, schedule, triggers, role config) is fetched from the server on daemon boot and on Socket.IO push. `DaemonState.automation.loopRollup` continues to be the low-latency status surface for the App. This phase requires: server-side CRUD endpoints for AgentLoop (role=generic), a one-time migration of existing CLI-local AgentLoops to the server (the daemon performs the upload on first boot after the upgrade), and a sync handler on the CLI side that subscribes to Socket.IO updates and persists the latest definition locally for offline operation.

**Phase 4 — Routes + UI converge.** Once Phase 3b is stable: `/v1/supervisor-loops/*` and `/v1/agent-loops/*` collapse into `/v1/agent-loops/*` with a `role` query parameter. The project page's `/project/[id]/supervisor-loop/[loopId]` route becomes a thin redirect to `/agent-loop/[id]` with a role-aware detail screen (supervisor role shows SupervisorRun/Action history and healthScore charts; generic role shows brief + working memory). The machine page's "管理智能体循环" card lists all AgentLoops on the machine regardless of role. The physical table is also renamed at this phase (drop `@@map("SupervisorLoop")`) so DB-level introspection matches the domain model.

## Open subordinate questions

These are deliberately NOT decided here. They are downstream of the principle and should each get their own ADR when the migration reaches that phase:

- **Cron-trigger ownership.** Server-side `supervisorScheduler` already fires supervisor-role loops. Today's generic AgentLoop schedules its own cron in the CLI. Phase 3 forces a choice: unify on server-side scheduling (simple, cron-fires-when-daemon-offline) or keep dual schedulers (faster startup, no DB round-trip per fire). Punt to a later ADR.
- **`auditApproveThreshold` for generic role.** Confidence-gated auto-approval is the centrepiece of supervisor autonomy. The generic role today has no equivalent ("autoRun" is a binary). A future ADR may extend this pattern across roles.
- **Backwards-compatible API window.** How long do we keep `/v1/supervisor-loops/*` aliased after Phase 4? Touch only when Phase 4 lands.

## Considered alternatives

- **Parallel evolution (option B in the design discussion).** Keep SupervisorLoop independent; port AgentLoop's KAIROS-equivalent capabilities (notification channels, push, `/brief`, Auto-Dream memory, webhook→loop bridges) into SupervisorLoop one-by-one. Rejected: same surface implemented twice, every new KAIROS capability costs 2× the work forever, and the conceptual confusion ("why are there two loops?") never resolves. Cheaper short-term, much more expensive long-term.
- **Shared `LoopRuntime` base (option C).** Extract a third abstraction both AgentLoop and SupervisorLoop build on. Rejected for now: a base layer with two consumers is hard to design well; the two-consumer case is the textbook "abstraction shaped for the wrong axis" risk that ADR-0009 warns against. Revisit only if a third loop kind appears (e.g. a `role: "research"`).
- **Keep both names, declare them aliases.** Rejected: "AgentLoop" and "SupervisorLoop" describe genuinely different shapes today (CLI-local generic vs. server-side supervisor autopilot). An alias would paper over the data + execution-locality difference and re-create the confusion at the implementation layer.
- **Phase 2 via Prisma view (first revision).** This ADR originally proposed `model SupervisorLoop` becoming a database view filtered on `role = "supervisor"`. Rejected on investigation: Prisma 7 views are a preview feature (not enabled in this project, only `relationJoins` is), and even when enabled they are **read-only** — `supervisorLoopEngine.ts` has 28 calls that include `update` / `updateMany` / `create` / `delete` / `deleteMany`, none of which compile against a Prisma view. A view target also cannot be the destination of a foreign key, so `SupervisorRun.loopId → SupervisorLoop.id` would break. The `@@map` + `role` approach (Phase 2 above) achieves the same outcome cheaper: zero data migration (column default backfills existing rows), zero FK breakage, and a one-shot search-and-replace in the two server files.

## Consequences

- New contributors learn one persistent-autonomy primitive (AgentLoop), not two. Claude Code's KAIROS framing maps to it directly.
- The `model SupervisorLoop` Prisma name survives only as a view during Phase 2; new schema work targets `model AgentLoop`.
- The project domain's `Project → SupervisorRun` relationship becomes `Project → AgentLoop (role=supervisor) → SupervisorRun`. SupervisorRun and SupervisorAction stay; their semantics are unchanged.
- `CONTEXT.md` declares the converged model upfront; the deprecation of standalone `SupervisorLoop` is signposted so future readers don't write code against the old shape.
- A future architecture review that proposes "split SupervisorLoop back out because the supervisor autonomy needs differ", or asks "why does the generic AgentLoop carry healthScoreTarget?" (it doesn't — that field is role-gated) should read this ADR first.
