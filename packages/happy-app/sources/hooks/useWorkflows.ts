/**
 * useWorkflows() — the central derivation that backs the Workflow IA.
 *
 * Per docs/plans/sessions-and-automation-ia.md, a **Workflow** (CONTEXT.md
 * first-class concept) is a *view* over existing entities, not a new DB
 * record. The merge logic — server loops + daemonState loops +
 * TriggerSchedules + WebhookRoutes → sorted Workflow[] — lives in
 * `sync/workflowAggregator.ts` as a pure function so it stays testable
 * without standing up the Zustand store.
 *
 * This hook owns the SUBSCRIPTION + FETCH side:
 *
 *   - Reads live storage (Sessions, Machines, Projects) via Zustand
 *     selectors.
 *   - Fetches triggers (cron + webhook) + server-managed AgentLoops on
 *     mount and on stale signals.
 *   - Throttles re-fetches through the shared
 *     `AUTOMATION_SUMMARY_THROTTLE_MS` constant so a swarm of stale
 *     signals collapses into one refetch per window.
 *   - Subscribes to:
 *       • `sync.onTaskStatusChanged` — legacy stale signal
 *       • `onWorkflowSourcesChanged` — fired by CreateLoopModal /
 *          webhook / schedule modals after a successful POST
 *       • `ingestEvents.on("agent-loops-stale" | "schedules-stale"
 *          | "webhooks-stale")` — real-time SyncUpdate fan-out
 *       • `AppState.change → "active"` — foreground catch-up
 *   - Hands the snapshot to `aggregateWorkflows` and returns the result.
 *
 * Phase 1 limits:
 *  - generic-role AgentLoops not yet reported by the daemon to the server
 *    (ADR-0022 phase 3b pending) appear with `isCliLocal: true`. They
 *    render in the list but flag reduced server-side visibility.
 *  - Triggers are fetched once on mount and refreshed via
 *    `sync.onTaskStatusChanged`; if the daemon fires a trigger between
 *    refreshes, the new run appears in the next refresh cycle.
 *
 * Phase 2 will add `sessionAdoptToLoop` write actions; the hook's read
 * path already covers their output (a Session's automationContext
 * flipping into a loop / trigger reattaches it to the right Workflow on
 * next render).
 */

import * as React from "react";
import { AppState } from "react-native";
import {
    useAllMachines,
    useAllSessions,
    useProjects,
} from "@/sync/storage";
import type { SerializedAgentLoop } from "@kmmao/happy-wire";
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
import {
    aggregateWorkflows,
    type Workflow,
    type AdhocWorkflow,
    type ScheduledWorkflow,
    type EventWorkflow,
    type LoopWorkflow,
    type WorkflowKind,
    type WorkflowAgentLoopSummary,
} from "@/sync/workflowAggregator";

// Re-export the Workflow types so existing consumers
// (`from '@/hooks/useWorkflows'`) keep working unchanged.
export type {
    Workflow,
    AdhocWorkflow,
    ScheduledWorkflow,
    EventWorkflow,
    LoopWorkflow,
    WorkflowKind,
    WorkflowAgentLoopSummary,
};

export interface UseWorkflowsResult {
    workflows: Workflow[];
    /** True until the first triggers fetch completes. Sessions/loops are
     *  storage-backed and don't gate the result. */
    loading: boolean;
    /** Trigger a manual refresh (in addition to the auto-refresh on
     *  task-status events). */
    refresh: () => void;
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
    // per-machine daemonState loops inside the aggregator (daemonState
    // wins on collision because it carries live runtime state).
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

    const workflows = React.useMemo<Workflow[]>(
        () =>
            aggregateWorkflows({
                allSessions,
                allMachines,
                allProjects,
                cronTriggers,
                webhookTriggers,
                serverLoops,
            }),
        [
            allSessions,
            allMachines,
            allProjects,
            cronTriggers,
            webhookTriggers,
            serverLoops,
        ],
    );

    return {
        workflows,
        loading: cronTriggers === null || webhookTriggers === null,
        refresh,
    };
}
