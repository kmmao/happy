import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchTasks } from "@/sync/apiTasks";
import { fetchInboxItems } from "@/sync/apiInbox";
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

export function useWorldEvents(filter?: WorldFilter): UseWorldEventsResult {
    const [events, setEvents] = React.useState<WorldEvent[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [tick, setTick] = React.useState(0);

    const refresh = React.useCallback(() => setTick((t) => t + 1), []);

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
                const filtered = filter
                    ? filterWorldEvents(sorted, filter)
                    : sorted;

                setEvents(filtered);
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

    return { events, loading, refresh };
}
