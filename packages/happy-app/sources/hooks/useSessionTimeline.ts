/**
 * Hook for fetching and subscribing to session timeline events.
 * Uses REST API for initial load, socket ephemeral events for real-time updates.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { ServerSessionEvent, fetchSessionEvents } from "@/sync/apiSessionEvents";
import { sync } from "@/sync/sync";

interface TimelineState {
    events: ServerSessionEvent[];
    total: number;
    loading: boolean;
    error: string | null;
}

export function useSessionTimeline(sessionId: string): TimelineState & { refresh: () => Promise<void> } {
    const [state, setState] = React.useState<TimelineState>({
        events: [],
        total: 0,
        loading: true,
        error: null,
    });

    const refresh = React.useCallback(async () => {
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const result = await fetchSessionEvents(credentials, sessionId, { limit: 200 });

            setState((prev) => ({
                ...prev,
                events: result.events,
                total: result.total,
                loading: false,
                error: null,
            }));
        } catch (err) {
            setState((prev) => ({
                ...prev,
                loading: false,
                error: String(err),
            }));
        }
    }, [sessionId]);

    // Initial load
    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    // Real-time: new session events via ephemeral
    React.useEffect(() => {
        return sync.onSessionEventCreated((event) => {
            // Only add events for this session
            if (event.sessionId !== sessionId) return;

            setState((prev) => ({
                ...prev,
                events: [event as ServerSessionEvent, ...prev.events],
                total: prev.total + 1,
            }));
        });
    }, [sessionId]);

    return { ...state, refresh };
}
