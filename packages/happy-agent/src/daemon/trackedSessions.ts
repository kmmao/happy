/**
 * Tracked session registry — lightweight PID-to-session mapping.
 *
 * Tracks processes spawned by the agent for lifecycle management
 * and status reporting. Does NOT persist across restarts (in-memory only).
 */

import type { ChildProcess } from "child_process";

export interface TrackedSession {
  readonly pid: number;
  readonly directory: string;
  readonly startedAt: number;
  childProcess?: ChildProcess;
  happySessionId?: string;
  lastActivityAt?: number;
  terminationReason?: string;
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
  };
}

const pidToSession = new Map<number, TrackedSession>();

export function trackSession(session: TrackedSession): void {
  pidToSession.set(session.pid, session);
}

export function untrackSession(pid: number): TrackedSession | undefined {
  const session = pidToSession.get(pid);
  pidToSession.delete(pid);
  return session;
}

export function getTrackedSession(pid: number): TrackedSession | undefined {
  return pidToSession.get(pid);
}

export function getAllTrackedSessions(): TrackedSession[] {
  return [...pidToSession.values()];
}

export function getTrackedSessionCount(): number {
  return pidToSession.size;
}
