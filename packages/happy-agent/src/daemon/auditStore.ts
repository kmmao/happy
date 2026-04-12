/**
 * AutomationAuditStore — in-memory ring buffer for automation events.
 *
 * Records job lifecycle events (enqueued, started, completed, failed)
 * for observability. Capped at maxEntries to prevent unbounded growth.
 * Queryable via RPC for dashboard / debugging.
 */

import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "job_enqueued"
  | "job_dispatched"
  | "job_completed"
  | "job_failed"
  | "job_retried"
  | "loop_started"
  | "loop_blocked"
  | "loop_paused";

export interface AuditEvent {
  readonly id: number;
  readonly kind: AuditEventKind;
  readonly timestamp: number;
  readonly jobId?: string;
  readonly dedupeKey?: string;
  readonly loopId?: string;
  readonly loopName?: string;
  readonly status?: string;
  readonly message?: string;
  readonly errorMessage?: string;
}

export interface AuditQuery {
  kind?: AuditEventKind;
  loopId?: string;
  limit?: number;
  since?: number;
}

export interface AuditStorOptions {
  maxEntries?: number;
}

// ---------------------------------------------------------------------------
// AutomationAuditStore
// ---------------------------------------------------------------------------

export class AutomationAuditStore {
  private readonly maxEntries: number;
  private readonly events: AuditEvent[] = [];
  private nextId = 1;

  constructor(options?: AuditStorOptions) {
    this.maxEntries = options?.maxEntries ?? 500;
  }

  /**
   * Record an audit event.
   */
  record(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
    const entry: AuditEvent = {
      ...event,
      id: this.nextId++,
      timestamp: Date.now(),
    };

    this.events.push(entry);

    // Ring buffer: trim from front when over capacity
    while (this.events.length > this.maxEntries) {
      this.events.shift();
    }

    logger.debug(`[AUDIT] ${entry.kind}: ${entry.message ?? entry.dedupeKey ?? entry.jobId ?? ""}`);
    return entry;
  }

  /**
   * Query events with optional filters.
   */
  query(filter?: AuditQuery): AuditEvent[] {
    const limit = filter?.limit ?? 50;
    let results = this.events;

    if (filter?.kind) {
      results = results.filter((e) => e.kind === filter.kind);
    }
    if (filter?.loopId) {
      results = results.filter((e) => e.loopId === filter.loopId);
    }
    if (filter?.since) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }

    // Return most recent first, capped at limit
    return results.slice(-limit).reverse();
  }

  /**
   * Summary counts by kind.
   */
  summarize(): Record<AuditEventKind, number> {
    const counts = {
      job_enqueued: 0,
      job_dispatched: 0,
      job_completed: 0,
      job_failed: 0,
      job_retried: 0,
      loop_started: 0,
      loop_blocked: 0,
      loop_paused: 0,
    };
    for (const event of this.events) {
      counts[event.kind]++;
    }
    return counts;
  }

  /**
   * Total number of stored events.
   */
  get size(): number {
    return this.events.length;
  }
}
