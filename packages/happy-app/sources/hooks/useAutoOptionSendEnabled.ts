import * as React from "react";
import { autoOptionSendService } from "@/sync/autoOptionSendService";

/**
 * Subscribe to whether auto-option-send is enabled for a session.
 * Lightweight — only triggers re-render when `enabled` changes.
 */
export function useAutoOptionSendEnabled(sessionId: string): boolean {
    const [enabled, setEnabled] = React.useState(
        () => autoOptionSendService.getState(sessionId).enabled,
    );

    React.useEffect(() => {
        // Sync in case it changed between render and effect
        setEnabled(autoOptionSendService.getState(sessionId).enabled);
        return autoOptionSendService.subscribe(sessionId, () => {
            const next = autoOptionSendService.getState(sessionId).enabled;
            setEnabled((prev) => (prev === next ? prev : next));
        });
    }, [sessionId]);

    return enabled;
}
