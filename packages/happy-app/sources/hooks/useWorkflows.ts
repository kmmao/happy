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
import {
    useAllMachines,
    useAllSessions,
} from "@/sync/storage";
import type { Machine, Session } from "@/sync/storageTypes";
import type { AgentLoopSummary } from "@kmmao/happy-wire";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchTriggerSchedules,
    type ServerTriggerSchedule,
} from "@/sync/apiTriggerSchedules";
import {
    fetchWebhookTriggers,
    type ServerWebhookTrigger,
} from "@/sync/apiWebhookTriggers";
import { sync } from "@/sync/sync";
import { useThrottledCallback } from "@/hooks/useThrottledCallback";
import { AUTOMATION_SUMMARY_THROTTLE_MS } from "@/components/machine/automationConstants";

export type WorkflowKind = "adhoc" | "scheduled" | "event" | "loop";

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
    loop: AgentLoopSummary;
    /**
     * True while ADR-0022 Phase 3b is unlanded for this loop's daemon:
     * the daemon hasn't surfaced this AgentLoop to the server yet, so
     * Trigger/Run history is incomplete. Phase 3b removes this flag.
     */
    isCliLocal: boolean;
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

const safeAutomationContext = (
    session: Session,
): { kind?: string; loopId?: string; triggerType?: string; triggerRef?: string } | null => {
    const ctx = (session.metadata as any)?.automationContext;
    return ctx && typeof ctx === "object" ? ctx : null;
};

export function useWorkflows(): UseWorkflowsResult {
    const allSessions = useAllSessions();
    const allMachines = useAllMachines();

    // Per-machine loops come from storage (daemonState.automation.loops);
    // triggers must be fetched. Keep them in component state and refresh on
    // task-status events.
    const [cronTriggers, setCronTriggers] = React.useState<ServerTriggerSchedule[] | null>(null);
    const [webhookTriggers, setWebhookTriggers] = React.useState<ServerWebhookTrigger[] | null>(null);

    const load = React.useCallback(async () => {
        const credentials = await TokenStorage.getCredentials().catch(() => null);
        if (!credentials) return;
        // Fetch all triggers across machines — list view spans the whole
        // account, so a per-machine filter would lose Workflows for
        // currently offline machines.
        const [cron, hooks] = await Promise.all([
            fetchTriggerSchedules(credentials).catch(() => ({ triggerSchedules: [], total: 0 })),
            fetchWebhookTriggers(credentials).catch(() => ({ webhookTriggers: [], total: 0 })),
        ]);
        setCronTriggers(cron.triggerSchedules);
        setWebhookTriggers(hooks.webhookTriggers);
    }, []);

    // Throttle subsequent loads (task fan-out can be high during a swarm).
    // Reuse the shared automation throttle constant so the whole UI ticks
    // in unison.
    const throttledLoad = useThrottledCallback(load, AUTOMATION_SUMMARY_THROTTLE_MS);

    React.useEffect(() => {
        void load();
    }, [load]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged(() => {
            throttledLoad();
        });
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
        // Walk every machine's daemonState.automation.loops. Each loop
        // becomes a LoopWorkflow; we collect sessions claimed by it via
        // `metadata.automationContext.loopId === loop.id`.
        for (const machine of allMachines) {
            const loops = ((machine.daemonState?.automation as any)?.loops ?? []) as AgentLoopSummary[];
            for (const loop of loops) {
                const loopSessions = (allSessions as Session[])
                    .filter((s) => {
                        if (typeof s === "string") return false;
                        const ctx = safeAutomationContext(s);
                        return ctx?.loopId === loop.id && s.metadata?.machineId === machine.id;
                    })
                    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
                loopSessions.forEach((s) => claimedSessions.add(s.id));

                const latestSessionTs = loopSessions[0]?.updatedAt ?? 0;
                const lastActivityAt = Math.max(latestSessionTs, loop.nextRunAt ?? 0);

                workflowList.push({
                    id: `loop:${loop.id}`,
                    kind: "loop",
                    displayName:
                        loop.name?.trim() ||
                        loop.directory.split("/").filter(Boolean).pop() ||
                        "Loop",
                    machineId: machine.id,
                    sessions: loopSessions,
                    lastActivityAt,
                    status: loop.runtimeState === "running"
                        ? "active"
                        : loop.runtimeState === "failed"
                            ? "error"
                            : loop.enabled
                                ? "idle"
                                : "archived",
                    loop,
                    // Server-served loops surface through daemonState. CLI-
                    // local loops won't appear here until ADR-0022 Phase 3b
                    // lands; when they do, this flag will need flipping
                    // based on a future `loop.serverManaged` field. For now
                    // everything we see has been reported by the daemon, so
                    // it's already server-visible — keep false.
                    isCliLocal: false,
                });
            }
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
    }, [allSessions, allMachines, cronTriggers, webhookTriggers]);

    return {
        workflows,
        loading: cronTriggers === null || webhookTriggers === null,
        refresh,
    };
}
