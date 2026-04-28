import * as React from "react";
import { gitStatusSync } from "@/sync/gitStatusSync";
import { sync } from "@/sync/sync";

export function useSessionVisibleEffect(sessionId: string): void {
  React.useEffect(() => {
    sync.onSessionVisible(sessionId);

    // Ensure project-scoped git sync is initialized for the active session.
    gitStatusSync.getSync(sessionId);
  }, [sessionId]);
}
