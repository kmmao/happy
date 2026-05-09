import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchWorldEvents } from "@/sync/apiWorldEvents";
import { sync } from "@/sync/sync";
import { storage } from "@/sync/storage";
import {
    adaptInboxToEvent,
    adaptSessionEventToEvent,
    adaptSupervisorStatusToEvent,
    filterWorldEvents,
    sortEventsByTime,
} from "./worldEventAdapter";
import type { WorldEvent, WorldFilter } from "./worldTypes";

interface UseWorldEventsResult {
    events: WorldEvent[];
    loading: boolean;
    refresh: () => void;
}

const MAX_EVENTS = 200;

function buildSessionLifecycleEvent(
    sessionId: string,
    isActive: boolean,
    occurredAt: number,
): WorldEvent {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    const project = state.getProjectForSession(sessionId);

    const path = session?.metadata?.path;
    const name = path
        ? path.split("/").filter(Boolean).pop() ?? path
        : sessionId.slice(0, 12);

    return {
        id: `session-lifecycle-${sessionId}-${occurredAt}`,
        originalId: sessionId,
        eventType: isActive ? "session.started" : "session.completed",
        title: name,
        summary: isActive ? "started" : "completed",
        occurredAt,
        severity: "info",
        source: {
            type: "session",
            projectId: project?.serverId ?? null,
            projectPath: path ?? null,
            machineId: session?.metadata?.machineId ?? null,
            sessionId,
        },
    };
}

export function useWorldEvents(filter?: WorldFilter): UseWorldEventsResult {
    const [events, setEvents] = React.useState<WorldEvent[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [tick, setTick] = React.useState(0);

    const refresh = React.useCallback(() => setTick((t) => t + 1), []);

    const filterRef = React.useRef(filter);
    filterRef.current = filter;

    // ── Initial load ─────────────────────────────────────────────────────────
    React.useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;

                const f = filterRef.current;
                const result = await fetchWorldEvents(credentials, {
                    projectId: f?.projectId ?? undefined,
                    machineId: f?.machineId ?? undefined,
                    eventTypePrefix: f?.eventTypePrefix ?? undefined,
                    severity: f?.severity ?? undefined,
                    limit: MAX_EVENTS,
                });

                if (cancelled) return;

                const allEvents: WorldEvent[] = [...result.events];

                // Synthesise session lifecycle events from local store
                const sessions = Object.values(storage.getState().sessions)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .slice(0, 30);

                for (const session of sessions) {
                    const sessionEvent = buildSessionLifecycleEvent(
                        session.id,
                        session.active,
                        session.updatedAt,
                    );
                    if (!f || filterWorldEvents([sessionEvent], f).length > 0) {
                        allEvents.push(sessionEvent);
                    }
                }

                setEvents(sortEventsByTime(allEvents).slice(0, MAX_EVENTS));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, filter?.projectId, filter?.machineId, filter?.eventTypePrefix, filter?.severity]);

    // ── Realtime: task / inbox / session-timeline / supervisor ───────────────
    React.useEffect(() => {
        const unsubTask = sync.onTaskStatusChanged((event) => {
            const eventPrefix = (event.triggerType === "cron" || event.triggerType === "webhook")
                ? `trigger.${event.triggerType}`
                : "task";
            const worldEvent: WorldEvent = {
                id: `task-rt-${event.taskId}-${Date.now()}`,
                originalId: event.taskId,
                eventType: `${eventPrefix}.${event.status}`,
                title: event.status === "failed" ? (event.errorMessage ?? "Task failed") : `Task ${event.status}`,
                summary: event.status,
                occurredAt: event.completedAt ?? Date.now(),
                severity: event.status === "failed" ? "critical" : "info",
                source: {
                    type: "machine",
                    machineId: event.machineId ?? null,
                    sessionId: event.sessionId ?? null,
                },
            };

            const f = filterRef.current;
            if (f && !filterWorldEvents([worldEvent], f).length) return;
            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubInbox = sync.onInboxNewItem((item) => {
            const worldEvent = adaptInboxToEvent(item);
            const f = filterRef.current;
            if (f && !filterWorldEvents([worldEvent], f).length) return;
            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubSessionEvent = sync.onSessionEventCreated((event) => {
            const state = storage.getState();
            const session = state.sessions[event.sessionId];
            // Resolve projectId from projectManager so session events are filterable by project
            const project = state.getProjectForSession(event.sessionId);
            const worldEvent = adaptSessionEventToEvent(
                event,
                project?.serverId ?? null,
                session?.metadata?.machineId ?? null,
            );

            const f = filterRef.current;
            if (f && !filterWorldEvents([worldEvent], f).length) return;
            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubSupervisor = sync.onSupervisorStatus((event) => {
            const worldEvent = adaptSupervisorStatusToEvent(event);
            const f = filterRef.current;
            if (f && !filterWorldEvents([worldEvent], f).length) return;
            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        // Unified world-event-created channel — covers memory.* and any future event types
        const unsubWorldEvent = sync.onWorldEventCreated((raw) => {
            const worldEvent: WorldEvent = {
                id: raw.id,
                originalId: raw.originalId,
                eventType: raw.eventType,
                title: raw.title,
                summary: raw.summary,
                occurredAt: raw.occurredAt,
                severity: raw.severity,
                source: {
                    type: raw.source.type as WorldEvent["source"]["type"],
                    projectId: raw.source.projectId ?? null,
                    projectPath: raw.source.projectPath ?? null,
                    machineId: raw.source.machineId ?? null,
                    sessionId: raw.source.sessionId ?? null,
                },
                parentTaskId: raw.parentTaskId ?? null,
            };

            const f = filterRef.current;
            if (f && !filterWorldEvents([worldEvent], f).length) return;
            setEvents((prev) => {
                // Skip if an event with the same originalId already arrived via a specific channel
                if (prev.some((e) => e.originalId === worldEvent.originalId && e.eventType === worldEvent.eventType)) {
                    return prev;
                }
                return [worldEvent, ...prev].slice(0, MAX_EVENTS);
            });
        });

        return () => {
            unsubTask();
            unsubInbox();
            unsubSessionEvent();
            unsubSupervisor();
            unsubWorldEvent();
        };
    }, []);

    // ── Realtime: session lifecycle via Zustand store ─────────────────────────
    // session.active: false→true emits session.started; true→false emits session.completed
    React.useEffect(() => {
        const unsub = storage.subscribe((state, prevState) => {
            if (state.sessions === prevState.sessions) return;

            const now = Date.now();
            const newEvents: WorldEvent[] = [];
            const f = filterRef.current;

            for (const [sessionId, session] of Object.entries(state.sessions)) {
                const prev = prevState.sessions[sessionId];

                const activeFlipped = prev !== undefined && prev.active !== session.active;
                const brandNew = prev === undefined && session.active;
                if (!activeFlipped && !brandNew) continue;

                const worldEvent = buildSessionLifecycleEvent(
                    sessionId,
                    session.active,
                    session.active ? session.activeAt : now,
                );

                if (f && !filterWorldEvents([worldEvent], f).length) continue;
                newEvents.push(worldEvent);
            }

            if (newEvents.length > 0) {
                setEvents((prev) => [...newEvents, ...prev].slice(0, MAX_EVENTS));
            }
        });

        return unsub;
    }, []);

    return { events, loading, refresh };
}
