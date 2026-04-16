export interface ResolveGuardianSessionOptions {
  candidateSessionId?: string;
  isSessionTracked: (sessionId: string) => boolean;
  forgetSession: (sessionId: string) => void;
  onStaleSession?: (sessionId: string) => void;
}

/**
 * Reuse guardian sessions only when they are still part of the daemon's
 * currently tracked live sessions. Stale guardian pointers should be cleared
 * rather than recycled into a new automation run.
 */
export function resolveGuardianSession({
  candidateSessionId,
  forgetSession,
  isSessionTracked,
  onStaleSession,
}: ResolveGuardianSessionOptions): string | undefined {
  if (!candidateSessionId) {
    return undefined;
  }

  if (isSessionTracked(candidateSessionId)) {
    return candidateSessionId;
  }

  forgetSession(candidateSessionId);
  onStaleSession?.(candidateSessionId);
  return undefined;
}
