/**
 * workflowAggregator — pure derivation of the Workflow IA view.
 *
 * Why a separate module
 * ---------------------
 * `useWorkflows()` (in `hooks/useWorkflows.ts`) used to inline a
 * ~245-line `useMemo` that merged four data sources into a typed
 * Workflow[] view. Adding a new Workflow kind (or fixing a merge bug
 * like the loopsById dedup precedence) meant editing the hook body and
 * mocking the entire Zustand storage to test.
 *
 * The derivation is a pure function of its inputs. This module hosts
 * that function so:
 *
 *   - the hook shrinks to subscriptions + fetches (~250 lines deleted),
 *   - the merge is unit-testable from a snapshot (no Zustand mocking),
 *   - the four Workflow kinds + their dedup precedence are pinned by
 *     tests that survive a hook rewrite,
 *   - the consumer-facing Workflow union (CONTEXT.md first-class
 *     concept) lives in the same place as the function that produces
 *     instances of it.
 *
 * The hook re-exports the Workflow types so existing import sites
 * (`from '@/hooks/useWorkflows'`) keep working unchanged.
 */

import type { Machine, Session } from "@/sync/storageTypes";
import type {
  AgentLoopSummary,
  SerializedAgentLoop,
} from "@kmmao/happy-wire";
import type { ServerTriggerSchedule } from "@/sync/apiTriggerSchedules";
import type { ServerWebhookTrigger } from "@/sync/apiWebhookTriggers";

export type WorkflowKind = "adhoc" | "scheduled" | "event" | "loop";

export type WorkflowAgentLoopSummary = AgentLoopSummary & {
  prompt?: string;
  createdAt?: number;
  updatedAt?: number;
  lastEnqueuedAt?: number;
  lastTriggerAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  /** Per-loop model-mode KEY + reasoning effort (server loops only). */
  modelMode?: string | null;
  effort?: string | null;
  /** Optional first-message slash command, hoisted from genericConfig. */
  bootstrapSlashCommand?: string;
  /**
   * Raw long-tail config bag (name, bootstrapSlashCommand, notification
   * channels, etc.). Carried through so the edit form can merge unknown
   * keys back into a PATCH instead of clobbering them.
   */
  genericConfig?: Record<string, unknown> | null;
};

interface BaseWorkflow {
  /** Stable derived id: `${kind}:${centerEntityId}` */
  id: string;
  kind: WorkflowKind;
  displayName: string;
  machineId: string;
  sessions: Session[];
  /** ms epoch; max of (center entity activity, latest session activity) */
  lastActivityAt: number;
  /** Coarse status for list-row coloring. */
  status: "active" | "idle" | "error" | "archived";
}

export interface AdhocWorkflow extends BaseWorkflow {
  kind: "adhoc";
  /** Always exactly one Session for an Ad-hoc Workflow. */
  session: Session;
}

export interface ScheduledWorkflow extends BaseWorkflow {
  kind: "scheduled";
  trigger: ServerTriggerSchedule;
  nextRunAt: number | null;
  runCount: number;
}

export interface EventWorkflow extends BaseWorkflow {
  kind: "event";
  trigger: ServerWebhookTrigger;
  triggerCount: number;
}

export interface LoopWorkflow extends BaseWorkflow {
  kind: "loop";
  loop: WorkflowAgentLoopSummary;
  /**
   * Server project id this loop belongs to — required to call the
   * server-side toggle/delete endpoints
   * (`/v1/projects/:projectId/agent-loops/...`). `null` for CLI-local
   * loops that only exist in daemonState (those can't be acted on
   * from the App; the row's menu skips the destructive actions).
   */
  projectId: string | null;
  /**
   * True while ADR-0022 Phase 3b is unlanded for this loop's daemon:
   * the daemon hasn't surfaced this AgentLoop to the server yet, so
   * Trigger/Run history is incomplete. Phase 3b removes this flag.
   */
  isCliLocal: boolean;
  /**
   * Role discriminator from ADR-0022. Lets the workflow row render a
   * small "supervisor" badge for autopilot-style loops without
   * forcing the Workflow IA to split them into a separate kind. CLI-
   * local loops surfaced through daemonState don't carry a role
   * field, so they default to "generic".
   */
  role: "generic" | "supervisor";
}

export type Workflow =
  | AdhocWorkflow
  | ScheduledWorkflow
  | EventWorkflow
  | LoopWorkflow;

/**
 * Project shape the aggregator needs. Avoids dragging the full
 * storageTypes `Project` definition into this file's type surface —
 * only `serverId` and `key.machineId` matter for the merge.
 */
export interface AggregatorProject {
  key: { machineId: string };
  serverId?: string | null;
}

export interface WorkflowAggregateInputs {
  allSessions: ReadonlyArray<Session | string>;
  allMachines: ReadonlyArray<Machine>;
  allProjects: ReadonlyArray<AggregatorProject>;
  /** null = first fetch not complete (caller passes null until ready). */
  cronTriggers: ServerTriggerSchedule[] | null;
  webhookTriggers: ServerWebhookTrigger[] | null;
  serverLoops: SerializedAgentLoop[] | null;
}

/**
 * Read `session.metadata.automationContext`. Stamped by the CLI daemon
 * when a Session is spawned by automation — see happy-cli's
 * `createSessionMetadata`. Manual (terminal) Sessions don't have it.
 * Returns `null` instead of `undefined` for a uniform branch shape.
 */
function safeAutomationContext(session: Session) {
  const ctx = session.metadata?.automationContext;
  return ctx && typeof ctx === "object" ? ctx : null;
}

/**
 * Map the server's `SerializedAgentLoop` into the daemon-side
 * `AgentLoopSummary` shape the workflow renderer already consumes.
 * Optional fields without server-side equivalents default to historical
 * CLI defaults so a fresh server-only loop renders cleanly.
 */
function serializedToSummary(
  loop: SerializedAgentLoop,
): WorkflowAgentLoopSummary {
  const genericConfig = (loop.genericConfig ?? null) as Record<
    string,
    unknown
  > | null;
  const nameFromConfig =
    genericConfig && typeof genericConfig.name === "string"
      ? (genericConfig.name as string)
      : undefined;
  const bootstrapFromConfig =
    genericConfig && typeof genericConfig.bootstrapSlashCommand === "string"
      ? (genericConfig.bootstrapSlashCommand as string)
      : undefined;
  return {
    id: loop.id,
    name: nameFromConfig,
    directory: loop.directory ?? "",
    enabled: loop.enabled ?? true,
    intervalMs: loop.intervalMs ?? 0,
    cronExpression: loop.cronExpression ?? undefined,
    iteration: loop.iteration ?? 0,
    prompt: loop.prompt ?? undefined,
    createdAt: loop.createdAt,
    updatedAt: loop.updatedAt,
    nextRunAt: loop.nextRunAt ?? 0,
    runtimeState:
      loop.status === "running"
        ? "active"
        : loop.status === "paused"
          ? "paused"
          : "idle",
    phase: loop.status === "running" ? "planning" : "sleeping",
    agent: loop.agent ?? "claude",
    modelMode: loop.modelMode ?? null,
    effort: loop.effort ?? null,
    bootstrapSlashCommand: bootstrapFromConfig,
    genericConfig,
  };
}

/**
 * Aggregate the live storage snapshot + fetched triggers into a sorted
 * Workflow[] view.
 *
 * The four sources fold in this order — the order is load-bearing and
 * preserved from the prior hook implementation:
 *
 *   1. Loops — server-fetched AgentLoops (ADR-0022 Phase 3b) first,
 *      per-machine daemonState loops second. daemonState wins on
 *      collision because it carries live runtime state; server-side
 *      `projectId` is preserved across the override.
 *   2. Scheduled triggers — one Workflow per `ServerTriggerSchedule`.
 *   3. Event triggers — one Workflow per `ServerWebhookTrigger`.
 *   4. Ad-hoc — every remaining unclaimed Session.
 *
 * The Sessions a Workflow "owns" are computed by matching
 * `automationContext.loopId` / `triggerRef` against each Session's
 * metadata. A Session that's claimed by a Loop/Trigger Workflow does NOT
 * become its own Ad-hoc Workflow.
 *
 * Final sort: `lastActivityAt` descending — same mental model as the
 * existing Sessions list.
 */
export function aggregateWorkflows(
  inputs: WorkflowAggregateInputs,
): Workflow[] {
  const {
    allSessions,
    allMachines,
    allProjects,
    cronTriggers,
    webhookTriggers,
    serverLoops,
  } = inputs;

  if (!allSessions) return [];

  const workflowList: Workflow[] = [];
  const claimedSessions = new Set<string>();

  // --- Loop workflows ---------------------------------------------
  const loopsById = new Map<
    string,
    {
      machineId: string;
      loop: WorkflowAgentLoopSummary;
      role: "generic" | "supervisor";
      projectId: string | null;
    }
  >();

  if (serverLoops) {
    const projectIdToMachineId = new Map<string, string>();
    for (const project of allProjects) {
      if (project.serverId) {
        projectIdToMachineId.set(project.serverId, project.key.machineId);
      }
    }
    for (const serverLoop of serverLoops) {
      const machineId = projectIdToMachineId.get(serverLoop.projectId) ?? "";
      loopsById.set(serverLoop.id, {
        machineId,
        loop: serializedToSummary(serverLoop),
        role: serverLoop.role,
        projectId: serverLoop.projectId,
      });
    }
  }

  for (const machine of allMachines) {
    const loops = ((machine.daemonState?.automation as any)?.loops ??
      []) as WorkflowAgentLoopSummary[];
    for (const loop of loops) {
      const existing = loopsById.get(loop.id);
      loopsById.set(loop.id, {
        machineId: machine.id,
        loop,
        role: existing?.role ?? "generic",
        // Preserve any projectId already set by pass 1 — daemonState
        // has no notion of server projectId.
        projectId: existing?.projectId ?? null,
      });
    }
  }

  for (const { machineId, loop, role, projectId } of loopsById.values()) {
    const loopSessions = (allSessions as Session[])
      .filter((s) => {
        if (typeof s === "string") return false;
        const ctx = safeAutomationContext(s);
        return ctx?.loopId === loop.id && s.metadata?.machineId === machineId;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    loopSessions.forEach((s) => claimedSessions.add(s.id));

    const latestSessionTs = loopSessions[0]?.updatedAt ?? 0;
    const loopActivityTs = Math.max(
      loop.lastStartedAt ?? 0,
      loop.lastEnqueuedAt ?? 0,
      loop.lastTriggerAt ?? 0,
      loop.updatedAt ?? 0,
      loop.createdAt ?? 0,
    );
    const lastActivityAt = Math.max(latestSessionTs, loopActivityTs);

    workflowList.push({
      id: `loop:${loop.id}`,
      kind: "loop",
      displayName:
        loop.name?.trim() ||
        loop.directory.split("/").filter(Boolean).pop() ||
        "Loop",
      machineId,
      sessions: loopSessions,
      lastActivityAt,
      status:
        loop.runtimeState === "running" || loop.runtimeState === "active"
          ? "active"
          : loop.runtimeState === "failed"
            ? "error"
            : loop.enabled
              ? "idle"
              : "archived",
      loop,
      projectId,
      isCliLocal: false,
      role,
    });
  }

  // --- Scheduled workflows ----------------------------------------
  if (cronTriggers) {
    for (const trigger of cronTriggers) {
      const triggerSessions = (allSessions as Session[])
        .filter((s) => {
          if (typeof s === "string") return false;
          const ctx = safeAutomationContext(s);
          return ctx?.triggerRef === trigger.id;
        })
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      triggerSessions.forEach((s) => claimedSessions.add(s.id));

      const latestSessionTs = triggerSessions[0]?.updatedAt ?? 0;
      const lastActivityAt = Math.max(
        latestSessionTs,
        trigger.lastRunAt ?? 0,
        trigger.updatedAt,
      );

      workflowList.push({
        id: `scheduled:${trigger.id}`,
        kind: "scheduled",
        displayName:
          trigger.name?.trim() ||
          trigger.cronExpression ||
          "Scheduled workflow",
        machineId: trigger.machineId,
        sessions: triggerSessions,
        lastActivityAt,
        status: trigger.enabled
          ? triggerSessions.some((s) => s.active)
            ? "active"
            : "idle"
          : "archived",
        trigger,
        nextRunAt: trigger.nextRunAt,
        runCount: trigger.runCount,
      });
    }
  }

  // --- Event workflows --------------------------------------------
  if (webhookTriggers) {
    for (const trigger of webhookTriggers) {
      const triggerSessions = (allSessions as Session[])
        .filter((s) => {
          if (typeof s === "string") return false;
          const ctx = safeAutomationContext(s);
          return ctx?.triggerRef === trigger.id;
        })
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      triggerSessions.forEach((s) => claimedSessions.add(s.id));

      const latestSessionTs = triggerSessions[0]?.updatedAt ?? 0;
      const lastActivityAt = Math.max(
        latestSessionTs,
        trigger.lastTriggeredAt ?? 0,
        trigger.updatedAt,
      );

      workflowList.push({
        id: `event:${trigger.id}`,
        kind: "event",
        displayName:
          trigger.name?.trim() || trigger.slug || "Webhook workflow",
        machineId: trigger.machineId,
        sessions: triggerSessions,
        lastActivityAt,
        status: trigger.enabled
          ? triggerSessions.some((s) => s.active)
            ? "active"
            : "idle"
          : "archived",
        trigger,
        triggerCount: trigger.triggerCount,
      });
    }
  }

  // --- Ad-hoc workflows ------------------------------------------
  for (const item of allSessions) {
    if (typeof item === "string") continue;
    const session = item as Session;
    if (claimedSessions.has(session.id)) continue;

    workflowList.push({
      id: `adhoc:${session.id}`,
      kind: "adhoc",
      displayName:
        session.metadata?.summary?.text?.trim() ||
        session.metadata?.path ||
        "Untitled",
      machineId: session.metadata?.machineId ?? "",
      sessions: [session],
      lastActivityAt: session.updatedAt ?? 0,
      status: session.active ? "active" : "archived",
      session,
    });
  }

  // Sort by lastActivityAt desc.
  workflowList.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return workflowList;
}
