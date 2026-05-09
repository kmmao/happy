import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchWorldEvents } from "@/sync/apiWorldEvents";
import { sync } from "@/sync/sync";
import { storage } from "@/sync/storage";
import {
    adaptInboxToEvent,
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

export function useWorldEvents(filter?: WorldFilter): UseWorldEventsResult {
    const [events, setEvents] = React.useState<WorldEvent[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [tick, setTick] = React.useState(0);

    const refresh = React.useCallback(() => setTick((t) => t + 1), []);

    const filterRef = React.useRef(filter);
    filterRef.current = filter;

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

                // Add local sessions (not covered by backend API)
                const sessions = Object.values(storage.getState().sessions)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .slice(0, 30);

                for (const session of sessions) {
                    const eventType = session.active ? "session.active" : "session.ended";
                    const path = session.metadata?.path;
                    const name = path ? path.split("/").filter(Boolean).pop() ?? path : session.id.slice(0, 12);
                    const sessionEvent: WorldEvent = {
                        id: `session-${session.id}`,
                        originalId: session.id,
                        eventType,
                        title: name,
                        summary: session.active ? "running" : "ended",
                        occurredAt: session.updatedAt,
                        severity: "info",
                        source: {
                            type: "session",
                            machineId: session.metadata?.machineId ?? null,
                            sessionId: session.id,
                        },
                    };
                    // Apply local filter for sessions
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

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, filter?.projectId, filter?.machineId, filter?.eventTypePrefix, filter?.severity]);

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
            if (f) {
                const [passes] = filterWorldEvents([worldEvent], f);
                if (!passes) return;
            }

            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubInbox = sync.onInboxNewItem((item) => {
            const worldEvent = adaptInboxToEvent(item);

            const f = filterRef.current;
            if (f) {
                const [passes] = filterWorldEvents([worldEvent], f);
                if (!passes) return;
            }

            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubSessionEvent = sync.onSessionEventCreated((event) => {
            const worldEvent: WorldEvent = {
                id: `session-event-rt-${event.id}`,
                originalId: event.id,
                eventType: `session.${event.eventType}`,
                title: event.summary,
                summary: "",
                occurredAt: event.createdAt,
                severity: "info",
                source: {
                    type: "session",
                    sessionId: event.sessionId,
                },
            };

            const f = filterRef.current;
            if (f) {
                const [passes] = filterWorldEvents([worldEvent], f);
                if (!passes) return;
            }

            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        const unsubSupervisor = sync.onSupervisorStatus((event) => {
            const worldEvent: WorldEvent = {
                id: `supervisor-rt-${event.runId}-${Date.now()}`,
                originalId: event.runId,
                eventType: `supervisor.${event.status}`,
                title: event.currentDimension
                    ? `Supervisor: ${event.currentDimension} (${event.dimensionIndex ?? 0}/${event.totalDimensions ?? 0})`
                    : `Supervisor ${event.status}`,
                summary: event.status,
                occurredAt: Date.now(),
                severity: event.status === "failed" ? "critical" : "info",
                source: {
                    type: "project",
                    projectId: event.projectId,
                },
            };

            const f = filterRef.current;
            if (f) {
                const [passes] = filterWorldEvents([worldEvent], f);
                if (!passes) return;
            }

            setEvents((prev) => [worldEvent, ...prev].slice(0, MAX_EVENTS));
        });

        return () => {
            unsubTask();
            unsubInbox();
            unsubSessionEvent();
            unsubSupervisor();
        };
    }, []);

    return { events, loading, refresh };
}
