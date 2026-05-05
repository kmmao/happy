import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchTasks } from "@/sync/apiTasks";
import { fetchInboxItems } from "@/sync/apiInbox";
import { sync } from "@/sync/sync";
import {
    adaptTaskToEvent,
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

                const [tasksResult, inboxResult] =
                    await Promise.allSettled([
                        fetchTasks(credentials, { limit: 50 }),
                        fetchInboxItems(credentials, { limit: 50 }),
                    ]);

                if (cancelled) return;

                const allEvents: WorldEvent[] = [];

                if (tasksResult.status === "fulfilled") {
                    for (const task of tasksResult.value.tasks) {
                        allEvents.push(adaptTaskToEvent(task));
                    }
                }

                if (inboxResult.status === "fulfilled") {
                    for (const item of inboxResult.value.items) {
                        allEvents.push(adaptInboxToEvent(item));
                    }
                }

                const sorted = sortEventsByTime(allEvents);
                const filtered = filterRef.current
                    ? filterWorldEvents(sorted, filterRef.current)
                    : sorted;

                setEvents(filtered.slice(0, MAX_EVENTS));
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
            const worldEvent: WorldEvent = {
                id: `task-rt-${event.taskId}-${Date.now()}`,
                originalId: event.taskId,
                eventType: `task.${event.status}`,
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

        return () => {
            unsubTask();
            unsubInbox();
        };
    }, []);

    return { events, loading, refresh };
}
