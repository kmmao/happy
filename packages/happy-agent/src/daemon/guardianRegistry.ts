/**
 * GuardianSessionRegistry — session reuse for recurring automation.
 *
 * When a loop or supervisor trigger spawns a session, the registry
 * remembers which Happy session ID was used. On subsequent runs,
 * it resolves the existing session so the spawner can --resume it
 * instead of creating a fresh session every iteration.
 *
 * Key hierarchy: loop:{loopId} > project:{projectId}
 *
 * In-memory only — no file persistence (daemon restart = fresh).
 */

import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardianEntry {
  readonly key: string;
  sessionId: string;
  loopId?: string;
  projectId?: string;
  updatedAt: number;
}

export interface ResolveInput {
  loopId?: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// GuardianSessionRegistry
// ---------------------------------------------------------------------------

export class GuardianSessionRegistry {
  private readonly entries = new Map<string, GuardianEntry>();

  /**
   * Find an existing session to reuse.
   * Tries loop key first, then project key.
   */
  resolve(input: ResolveInput): string | null {
    if (input.loopId) {
      const entry = this.entries.get(`loop:${input.loopId}`);
      if (entry) {
        logger.debug(`[GUARDIAN] Resolved session ${entry.sessionId} for loop:${input.loopId}`);
        return entry.sessionId;
      }
    }
    if (input.projectId) {
      const entry = this.entries.get(`project:${input.projectId}`);
      if (entry) {
        logger.debug(`[GUARDIAN] Resolved session ${entry.sessionId} for project:${input.projectId}`);
        return entry.sessionId;
      }
    }
    return null;
  }

  /**
   * Remember a session for future reuse.
   * Stores under both loop and project keys if available.
   */
  remember(sessionId: string, input: ResolveInput): void {
    const now = Date.now();
    if (input.loopId) {
      const key = `loop:${input.loopId}`;
      this.entries.set(key, {
        key,
        sessionId,
        loopId: input.loopId,
        projectId: input.projectId,
        updatedAt: now,
      });
      logger.debug(`[GUARDIAN] Remembered ${sessionId} for ${key}`);
    }
    if (input.projectId) {
      const key = `project:${input.projectId}`;
      // Only set project key if no loop-specific entry exists for this project
      if (!this.entries.has(key)) {
        this.entries.set(key, {
          key,
          sessionId,
          projectId: input.projectId,
          updatedAt: now,
        });
        logger.debug(`[GUARDIAN] Remembered ${sessionId} for ${key}`);
      }
    }
  }

  /**
   * Forget a specific session (e.g., after it exits).
   */
  forgetSession(sessionId: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`[GUARDIAN] Forgot session ${sessionId} (${removed} entries)`);
    }
    return removed;
  }

  /**
   * Forget all entries for a loop.
   */
  forgetLoop(loopId: string): boolean {
    return this.entries.delete(`loop:${loopId}`);
  }

  /**
   * Get all entries (for observability).
   */
  getSnapshot(): GuardianEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Number of tracked guardian entries.
   */
  get size(): number {
    return this.entries.size;
  }
}
