/**
 * Tracked session registry — PID-to-session mapping with optional
 * JSON file persistence for daemon restart recovery.
 */

import type { ChildProcess } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { logger } from "../logger";

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

/** Serializable subset (no ChildProcess). */
interface PersistedSession {
  pid: number;
  directory: string;
  startedAt: number;
  happySessionId?: string;
  lastActivityAt?: number;
  automationContext?: TrackedSession["automationContext"];
}

const pidToSession = new Map<number, TrackedSession>();
let persistPath: string | null = null;

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function trackSession(session: TrackedSession): void {
  pidToSession.set(session.pid, session);
  flush();
}

export function untrackSession(pid: number): TrackedSession | undefined {
  const session = pidToSession.get(pid);
  pidToSession.delete(pid);
  flush();
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

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Enable file persistence. Call once at daemon startup.
 * Loads existing sessions and validates PIDs are still alive.
 */
export function enablePersistence(filePath: string): void {
  persistPath = filePath;
  load();
}

function load(): void {
  if (!persistPath) return;
  try {
    const raw = readFileSync(persistPath, "utf-8");
    const entries = JSON.parse(raw) as PersistedSession[];
    let recovered = 0;
    for (const entry of entries) {
      // Validate PID is still alive
      try {
        process.kill(entry.pid, 0);
      } catch {
        continue; // PID dead, skip
      }
      pidToSession.set(entry.pid, {
        pid: entry.pid,
        directory: entry.directory,
        startedAt: entry.startedAt,
        happySessionId: entry.happySessionId,
        lastActivityAt: entry.lastActivityAt,
        automationContext: entry.automationContext,
      });
      recovered++;
    }
    if (recovered > 0) {
      logger.debug(`[TRACKED] Recovered ${recovered} sessions from ${persistPath}`);
    }
  } catch {
    // File doesn't exist or is invalid — start fresh
  }
}

function flush(): void {
  if (!persistPath) return;
  try {
    const entries: PersistedSession[] = [...pidToSession.values()].map((s) => ({
      pid: s.pid,
      directory: s.directory,
      startedAt: s.startedAt,
      happySessionId: s.happySessionId,
      lastActivityAt: s.lastActivityAt,
      automationContext: s.automationContext,
    }));
    mkdirSync(dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    logger.debug(`[TRACKED] Failed to persist: ${err}`);
  }
}
