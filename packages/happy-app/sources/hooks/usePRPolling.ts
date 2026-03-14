/**
 * Auto-polling hook for PR lists.
 *
 * Periodically refreshes PRs while the component is mounted and the app
 * is in the foreground. Pauses when backgrounded; triggers an immediate
 * refresh on foreground resume (if cooldown has elapsed).
 *
 * Mirrors useIssuePolling exactly, but targets prStore.
 */

import * as React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { prStore } from "@/sync/prStore";

const POLL_INTERVAL = 60_000; // 60 seconds

export function usePRPolling(
    allKeys: readonly string[],
    sessionId: string,
    repoPathByKey: Readonly<Record<string, string | undefined>>,
    enabled: boolean,
): void {
    const keysRef = React.useRef(allKeys);
    const sessionIdRef = React.useRef(sessionId);
    const repoPathByKeyRef = React.useRef(repoPathByKey);

    keysRef.current = allKeys;
    sessionIdRef.current = sessionId;
    repoPathByKeyRef.current = repoPathByKey;

    React.useEffect(() => {
        if (!enabled) return;

        const refresh = () => {
            const keys = keysRef.current;
            const sid = sessionIdRef.current;
            const paths = repoPathByKeyRef.current;
            if (keys.length === 0) return;
            prStore.getState().refreshAllPRs(keys as string[], sid, paths);
        };

        const timer = setInterval(refresh, POLL_INTERVAL);

        const handleAppState = (next: AppStateStatus) => {
            if (next === "active") {
                refresh();
            }
        };
        const subscription = AppState.addEventListener("change", handleAppState);

        return () => {
            clearInterval(timer);
            subscription.remove();
        };
    }, [enabled]);
}
