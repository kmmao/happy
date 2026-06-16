/**
 * useWorkflows() — the central derivation that backs the Workflow IA.
 *
 * Per docs/plans/sessions-and-automation-ia.md, a Workflow is a *view* over
 * existing entities, not a new DB record. This hook walks the live storage
 * (Sessions + per-machine daemonState.automation.loops) plus fetched
 * Triggers (cron + webhook) and groups them under a Workflow tagged union.
 *
 * Phase 1 limits:
 *  - generic-role AgentLoops not yet reported by the daemon to the server
 *    (ADR-0022 phase 3b pending) appear with `isCliLocal: true`. They render
 *    in the list but flag reduced server-side visibility.
 *  - Triggers are fetched once on mount and refreshed via
 *    `sync.onTaskStatusChanged`; if the daemon fires a trigger between
 *    refreshes, the new run appears in the next refresh cycle.
 *
 * Phase 2 will add `sessionAdoptToLoop` write actions; the hook's read path
 * already covers their output (a Session's automationContext flipping into
 * a loop / trigger reattaches it to the right Workflow on next render).
 */

import * as React from "react";
import { AppState } from "react-native";
import {
    useAllMachines,
    useAllSessions,
    useProjects,
} from "@/sync/storage";
import type { Machine, Session } from "@/sync/storageTypes";
import type { AgentLoopSummary, SerializedAgentLoop } from "@kmmao/happy-wire";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchTriggerSchedules,
    type ServerTriggerSchedule,
} from "@/sync/apiTriggerSchedules";
import {
    fetchWebhookTriggers,
    type ServerWebhookTrigger,
} from "@/sync/apiWebhookTriggers";
import { fetchAgentLoopsAcrossProjects } from "@/sync/apiAgentLoops";
import { onWorkflowSourcesChanged } from "@/sync/workflowBus";
import { sync } from "@/sync/sync";
import { ingestEvents } from "@/sync/ingest/dispatcher";
import { useThrottledCallback } from "@/hooks/useThrottledCallback";
import { AUTOMATION_SUMMARY_THROTTLE_MS } from "@/components/machine/automationConstants";
import { log } from "@/log";

// Phase C — wall-clock polling is gone. All three workflow kinds
// ride real-time SyncUpdates (agent-loop-* / trigger-schedule-* /
// webhook-trigger-*) emitted by the server on every state change.
// AppState foreground transition is the only catch-up signal kept,
// for the rare case where the socket missed events while backgrounded.

export type WorkflowKind = "adhoc" | "scheduled" | "event" | "loop";

type WorkflowAgentLoopSummary = AgentLoopSummary & {
    prompt?: string;
    createdAt?: number;
    updatedAt?: number;
    lastEnqueuedAt?: number;
    lastTriggerAt?: number;
    lastStartedAt?: number;
    lastCompletedAt?: number;
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

export interface UseWorkflowsResult {
    workflows: Workflow[];
    /** True until the first triggers fetch completes. Sessions/loops are
     *  storage-backed and don't gate the result. */
    loading: boolean;
    /** Trigger a manual refresh (in addition to the auto-refresh on
     *  task-status events). */
    refresh: () => void;
}

const safeAutomationContext = (session: Session) => {
    // session.metadata.automationContext is stamped by the CLI daemon when the
    // Session is spawned by automation — see happy-cli's createSessionMetadata
    // and MetadataSchema in storageTypes.ts. Manual ("terminal") Sessions
    // don't have it.
    const ctx = session.metadata?.automationContext;
    return ctx && typeof ctx === "object" ? ctx : null;
};

/**
 * Map the server's verbose SerializedAgentLoop into the daemon-side
 * AgentLoopSummary shape that the workflow renderer already consumes.
 * Optional fields without server-side equivalents default to the
 * historical CLI defaults.
 */
function serializedToSummary(loop: SerializedAgentLoop): WorkflowAgentLoopSummary {
    const genericConfig = (loop.genericConfig ?? null) as Record<string, unknown> | null;
    const nameFromConfig =
        genericConfig && typeof genericConfig.name === "string"
            ? (genericConfig.name as string)
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
        // SerializedAgentLoop's nextRunAt is null when no future slot is
        // scheduled. Preserve that as 0 for the legacy summary shape, but
        // consumers must treat 0 as "never" instead of formatting 1970.
        nextRunAt: loop.nextRunAt ?? 0,
        runtimeState: loop.status === "running" ? "active" : loop.status === "paused" ? "paused" : "idle",
        phase: loop.status === "running" ? "planning" : "sleeping",
        agent: loop.agent ?? "claude",
    };
}

export function useWorkflows(): UseWorkflowsResult {
    const allSessions = useAllSessions();
    const allMachines = useAllMachines();
    const allProjects = useProjects();

    // Per-machine loops come from storage (daemonState.automation.loops);
    // triggers must be fetched. Keep them in component state and refresh on
    // task-status events.
    const [cronTriggers, setCronTriggers] = React.useState<ServerTriggerSchedule[] | null>(null);
    const [webhookTriggers, setWebhookTriggers] = React.useState<ServerWebhookTrigger[] | null>(null);
    // ADR-0022 Phase 3b — server-managed generic AgentLoops. Fetched per
    // project (the only list endpoint we have) and merged with the
    // per-machine daemonState loops below; daemonState wins on collision
    // because it carries live runtime state.
    const [serverLoops, setServerLoops] = React.useState<SerializedAgentLoop[] | null>(null);

    // Snapshot the project ids we want to fan out across, recomputed
    // when projects change. JSON-stringify lets us treat it as a stable
    // dependency without depending on object identity.
    const serverProjectIds = React.useMemo(
        () =>
            allProjects
                .map((p) => p.serverId)
                .filter((id): id is string => typeof id === "string" && id.length > 0)
                .sort(),
        [allProjects],
    );
    const serverProjectIdsKey = serverProjectIds.join(",");

    const load = React.useCallback(async () => {
        const credentials = await TokenStorage.getCredentials().catch(() => null);
        if (!credentials) return;
        // [diag:nextRunAt] mark this load invocation so we can correlate
        // the fetch result with the trigger that scheduled it (mount,
        // task-status, stale event, foreground, …). Remove together with
        // the other [diag:nextRunAt] log lines below once the
        // schedule-time-not-updating issue is resolved.
        const loadStartedAt = Date.now();
        log.log(`[useWorkflows] load() begin @${loadStartedAt}`);
        // Fetch all triggers across machines — list view spans the whole
        // account, so a per-machine filter would lose Workflows for
        // currently offline machines.
        const [cron, hooks, loops] = await Promise.all([
            fetchTriggerSchedules(credentials).catch((err) => {
                log.log('[useWorkflows] fetchTriggerSchedules failed', err);
                return { triggerSchedules: [], total: 0 };
            }),
            fetchWebhookTriggers(credentials).catch(() => ({ webhookTriggers: [], total: 0 })),
            // ADR-0022 Phase 4 — omit `role` so the unified endpoint
            // returns BOTH supervisor + generic rows. The workflow row
            // renders a small role badge to distinguish supervisor
            // (autopilot) loops from generic ones.
            fetchAgentLoopsAcrossProjects(credentials, serverProjectIds)
                .catch(() => [] as SerializedAgentLoop[]),
        ]);
        // [diag:nextRunAt] dump every cron trigger's nextRunAt so we can
        // tell whether the server is advancing it. Compare consecutive
        // log lines for the same id: if nextRunAt stays identical past
        // its own timestamp, the server didn't tick (runner down /
        // schedule disabled / claim race). If it advances here but the
        // UI still shows the old value, the bug is in the render path.
        log.log(
            `[useWorkflows] load() done in ${Date.now() - loadStartedAt}ms — cron=${cron.triggerSchedules.length} hooks=${hooks.webhookTriggers.length} loops=${loops.length}`,
        );
        for (const t of cron.triggerSchedules) {
            log.log(
                `[useWorkflows]   cron ${t.id} name=${JSON.stringify(t.name ?? null)} enabled=${t.enabled} nextRunAt=${t.nextRunAt ? new Date(t.nextRunAt).toISOString() : null} lastRunAt=${t.lastRunAt ? new Date(t.lastRunAt).toISOString() : null} runCount=${t.runCount}`,
            );
        }
        setCronTriggers(cron.triggerSchedules);
        setWebhookTriggers(hooks.webhookTriggers);
        setServerLoops(loops);
    }, [serverProjectIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Throttle subsequent loads (task fan-out can be high during a swarm).
    // Reuse the shared automation throttle constant so the whole UI ticks
    // in unison.
    const throttledLoad = useThrottledCallback(load, AUTOMATION_SUMMARY_THROTTLE_MS);

    React.useEffect(() => {
        void load();
    }, [load]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged(() => {
            log.log('[useWorkflows] trigger: task-status-changed → throttledLoad');
            throttledLoad();
        });
    }, [throttledLoad]);

    React.useEffect(() => {
        // Workflow create-modals (loop, webhook, schedule) fire this after
        // a successful POST so the list reflects the new row without
        // waiting for the next throttle tick.
        return onWorkflowSourcesChanged(() => {
            log.log('[useWorkflows] trigger: workflow-sources-changed → throttledLoad');
            throttledLoad();
        });
    }, [throttledLoad]);

    React.useEffect(() => {
        // Real-time path for all three workflow kinds. Server emits:
        //   - agent-loop-updated / agent-loop-deleted on every CRUD /
        //     iteration / pause / resume (agentLoopEngine)
        //   - trigger-schedule-updated / -deleted on every cron tick +
        //     CRUD (triggerScheduleRunner + triggerScheduleRoutes)
        //   - webhook-trigger-updated / -deleted on every fire + CRUD
        //     (webhookTriggerRoutes)
        // syncUpdateIngest funnels each pair into one stale IngestEvent.
        // All three subscriptions throttle through the same throttledLoad
        // so a burst of events triggers at most one refetch per window.
        // [diag:nextRunAt] log each stale signal so you can tell whether
        // the server is actually pushing trigger-schedule-updated. If you
        // never see "schedules-stale" around a known cron tick, the
        // problem is upstream (server runner / emit / socket).
        const offLoops = ingestEvents.on("agent-loops-stale", () => {
            log.log('[useWorkflows] stale: agent-loops → throttledLoad');
            throttledLoad();
        });
        const offSchedules = ingestEvents.on("schedules-stale", () => {
            log.log('[useWorkflows] stale: schedules → throttledLoad');
            throttledLoad();
        });
        const offWebhooks = ingestEvents.on("webhooks-stale", () => {
            log.log('[useWorkflows] stale: webhooks → throttledLoad');
            throttledLoad();
        });
        return () => {
            offLoops();
            offSchedules();
            offWebhooks();
        };
    }, [throttledLoad]);

    React.useEffect(() => {
        // App-foreground refresh — safety net for the case where socket
        // SyncUpdates were missed while the tab/app was backgrounded
        // (browser may suspend, RN AppState may pause socket). Catches
        // up the moment user returns. Skip initial fire (mount-load
        // already covers it).
        let isFirst = true;
        const sub = AppState.addEventListener("change", (state) => {
            if (state !== "active") return;
            if (isFirst) {
                isFirst = false;
                return;
            }
            throttledLoad();
        });
        return () => sub.remove();
    }, [throttledLoad]);

    const refresh = React.useCallback(() => {
        void load();
    }, [load]);

    const workflows = React.useMemo<Workflow[]>(() => {
        if (!allSessions) return [];

        const workflowList: Workflow[] = [];
        // sessionId -> already-claimed-by-workflow flag
        const claimedSessions = new Set<string>();

        // --- Loop workflows -------------------------------------------
        // Two data sources, merged by loop.id (daemon-state row wins
        // because it carries live runtime state from the daemon):
        //
        //   1. Per-machine daemonState.automation.loops — historical and
        //      still authoritative for CLI-local loops that haven't been
        //      migrated server-side yet (ADR-0022 migration tool, Batch 4).
        //   2. Server-fetched generic loops from
        //      /v1/projects/:projectId/agent-loops (ADR-0022 Phase 3b).
        //      Surfaces loops the App just created via CreateLoopModal
        //      before the daemon-state push arrives, and any loop whose
        //      target daemon is currently offline.
        const loopsById = new Map<
            string,
            {
                machineId: string;
                loop: WorkflowAgentLoopSummary;
                role: "generic" | "supervisor";
                // null = CLI-local (no server projectId yet); set when
                // pass 1 (serverLoops) sees the loop. Pass 2 (daemonState)
                // intentionally does NOT clobber a previously-set value
                // — once a loop is known server-side, that mapping wins.
                projectId: string | null;
            }
        >();

        // Pass 1: server-fetched loops land first; per-machine daemonState
        // entries overwrite them in pass 2 (live runtime state wins).
        if (serverLoops) {
            // Build a quick projectId → machineId map so we can attribute
            // server loops to the right machine column. Projects without a
            // serverId never get matched (they wouldn't be in serverLoops
            // anyway), and unmatched loops surface under an empty
            // machineId (filtered out of the list rendering later).
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

        // Pass 2: walk every machine's daemonState.automation.loops. Each
        // loop overwrites any same-id server entry from pass 1. The CLI
        // only surfaces generic loops via daemonState (supervisor lives
        // in a separate server-only table), so the role on this pass is
        // always "generic" unless the server pass already tagged it as
        // supervisor (in which case daemonState shouldn't have it).
        for (const machine of allMachines) {
            const loops = ((machine.daemonState?.automation as any)?.loops ?? []) as WorkflowAgentLoopSummary[];
            for (const loop of loops) {
                const existing = loopsById.get(loop.id);
                loopsById.set(loop.id, {
                    machineId: machine.id,
                    loop,
                    role: existing?.role ?? "generic",
                    // Preserve any projectId already set by pass 1 —
                    // daemonState has no notion of server projectId.
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
                status: loop.runtimeState === "running" || loop.runtimeState === "active"
                    ? "active"
                    : loop.runtimeState === "failed"
                        ? "error"
                        : loop.enabled
                            ? "idle"
                            : "archived",
                loop,
                projectId,
                // Server-managed loops surface either via daemonState (CLI
                // already aware) or via the server fetch (CLI hasn't yet
                // received its trigger). Either way the loop is on the
                // server — `isCliLocal` is for the inverse case
                // (CLI-only, pre-migration); the Batch 4 migration tool
                // lifts that flag for each row it uploads.
                isCliLocal: false,
                role,
            });
        }

        // --- Scheduled workflows --------------------------------------
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

        // --- Event workflows ------------------------------------------
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
                        trigger.name?.trim() ||
                        trigger.slug ||
                        "Webhook workflow",
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

        // --- Ad-hoc workflows -----------------------------------------
        // Every remaining (unclaimed) Session becomes its own Ad-hoc
        // Workflow. Order is preserved via the final sort.
        for (const item of allSessions) {
            if (typeof item === "string") continue;
            const session = item as Session;
            if (claimedSessions.has(session.id)) continue;

            const ctx = safeAutomationContext(session);
            // Sessions whose context references an unknown trigger/loop
            // (e.g. trigger was deleted but server didn't backfill the
            // session) still land here as Ad-hoc rather than becoming
            // ghost-workflow rows. Surface a small "orphan" indicator in
            // the row UI if a future ADR adds it.
            workflowList.push({
                id: `adhoc:${session.id}`,
                kind: "adhoc",
                displayName: session.metadata?.summary?.text?.trim() || session.metadata?.path || "Untitled",
                machineId: session.metadata?.machineId ?? "",
                sessions: [session],
                lastActivityAt: session.updatedAt ?? 0,
                status: session.active
                    ? "active"
                    : "archived",
                session,
            });

            // Mark the orphan context for future surfacing
            void ctx;
        }

        // Sort by lastActivityAt desc — most recently relevant Workflow
        // first, matching the existing Sessions list mental model.
        workflowList.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
        return workflowList;
    }, [allSessions, allMachines, allProjects, cronTriggers, webhookTriggers, serverLoops]);

    return {
        workflows,
        loading: cronTriggers === null || webhookTriggers === null,
        refresh,
    };
}
