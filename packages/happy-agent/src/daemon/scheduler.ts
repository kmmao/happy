/**
 * AutomationScheduler — lightweight in-memory job queue for agent triggers.
 *
 * Features:
 * - Priority queue (urgent > user > background)
 * - dedupeKey deduplication (queued/dispatching/running)
 * - Concurrency limit (maxConcurrentJobs)
 * - Retry with incremental backoff (attempt * retryDelayMs)
 * - Ring buffer for recent completions (observability)
 */

import { randomUUID } from "crypto";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobPriority = "urgent" | "user" | "background";
export type JobStatus = "queued" | "dispatching" | "running" | "completed" | "failed";

export interface SchedulerJob {
  readonly id: string;
  readonly kind: "webhook" | "supervisor" | "task";
  readonly dedupeKey: string;
  readonly priority: JobPriority;
  status: JobStatus;
  attempt: number;
  readonly maxAttempts: number;
  readonly createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  errorMessage?: string;
  pid?: number;
  /** The thunk that performs the actual work (spawn session etc.) */
  readonly run: (jobId: string) => Promise<{ pid: number }>;
}

export interface EnqueueOptions {
  kind: SchedulerJob["kind"];
  dedupeKey: string;
  priority: JobPriority;
  run: (jobId: string) => Promise<{ pid: number }>;
}

export interface EnqueueResult {
  job: SchedulerJob;
  deduped: boolean;
}

export interface SchedulerStatus {
  queueLength: number;
  runningCount: number;
  recentCompletions: Array<{
    id: string;
    kind: string;
    dedupeKey: string;
    status: "completed" | "failed";
    completedAt: number;
    errorMessage?: string;
  }>;
}

export type AuditCallback = (event: {
  kind: "job_enqueued" | "job_dispatched" | "job_completed" | "job_failed" | "job_retried";
  jobId: string;
  dedupeKey: string;
  message?: string;
  errorMessage?: string;
}) => void;

export interface SchedulerOptions {
  maxConcurrentJobs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
  maxRecentCompletions?: number;
  onAudit?: AuditCallback;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<JobPriority, number> = {
  urgent: 0,
  user: 1,
  background: 2,
};

const ACTIVE_STATUSES = new Set<JobStatus>(["queued", "dispatching", "running"]);

// ---------------------------------------------------------------------------
// AutomationScheduler
// ---------------------------------------------------------------------------

export class AutomationScheduler {
  private readonly maxConcurrentJobs: number;
  private readonly retryDelayMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly maxRecentCompletions: number;
  private readonly onAudit: AuditCallback | null;

  /** Active jobs indexed by id. */
  private readonly jobs = new Map<string, SchedulerJob>();
  /** dedupeKey → jobId for fast dedup lookups. */
  private readonly dedupeIndex = new Map<string, string>();
  /** Ring buffer for completed/failed jobs. */
  private readonly recentCompletions: SchedulerStatus["recentCompletions"] = [];

  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumping = false;

  constructor(options?: SchedulerOptions) {
    this.maxConcurrentJobs = options?.maxConcurrentJobs ?? 2;
    this.retryDelayMs = options?.retryDelayMs ?? 5000;
    this.defaultMaxAttempts = options?.maxAttempts ?? 3;
    this.maxRecentCompletions = options?.maxRecentCompletions ?? 50;
    this.onAudit = options?.onAudit ?? null;

    this.pumpTimer = setInterval(() => this.pump(), 1000);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  enqueue(opts: EnqueueOptions): EnqueueResult {
    // Dedup check
    const existingId = this.dedupeIndex.get(opts.dedupeKey);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && ACTIVE_STATUSES.has(existing.status)) {
        logger.debug(`[SCHEDULER] Deduped: ${opts.dedupeKey} (job ${existingId} is ${existing.status})`);
        return { job: existing, deduped: true };
      }
    }

    const job: SchedulerJob = {
      id: randomUUID(),
      kind: opts.kind,
      dedupeKey: opts.dedupeKey,
      priority: opts.priority,
      status: "queued",
      attempt: 0,
      maxAttempts: this.defaultMaxAttempts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt: Date.now(),
      run: opts.run,
    };

    this.jobs.set(job.id, job);
    this.dedupeIndex.set(job.dedupeKey, job.id);

    logger.debug(`[SCHEDULER] Enqueued: ${job.kind} ${job.dedupeKey} (${job.priority}) id=${job.id}`);
    this.onAudit?.({ kind: "job_enqueued", jobId: job.id, dedupeKey: job.dedupeKey, message: `${job.kind}:${job.priority}` });

    // Immediate pump attempt
    this.pump();

    return { job, deduped: false };
  }

  markCompleted(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") return;

    job.status = "completed";
    job.updatedAt = Date.now();
    logger.debug(`[SCHEDULER] Completed: ${job.kind} ${job.dedupeKey} id=${jobId}`);
    this.onAudit?.({ kind: "job_completed", jobId, dedupeKey: job.dedupeKey });
    this.finalize(job);
  }

  markFailed(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") return;

    job.errorMessage = error;
    job.updatedAt = Date.now();

    // Retry?
    if (job.attempt < job.maxAttempts) {
      job.status = "queued";
      job.nextRunAt = Date.now() + job.attempt * this.retryDelayMs;
      logger.debug(`[SCHEDULER] Retry queued: ${job.dedupeKey} attempt=${job.attempt}/${job.maxAttempts} nextRunAt=+${job.attempt * this.retryDelayMs}ms`);
      this.onAudit?.({ kind: "job_retried", jobId, dedupeKey: job.dedupeKey, errorMessage: error, message: `attempt ${job.attempt}/${job.maxAttempts}` });
      this.pump();
      return;
    }

    job.status = "failed";
    logger.debug(`[SCHEDULER] Failed (exhausted): ${job.kind} ${job.dedupeKey} id=${jobId}: ${error}`);
    this.onAudit?.({ kind: "job_failed", jobId, dedupeKey: job.dedupeKey, errorMessage: error });
    this.finalize(job);
  }

  getStatus(): SchedulerStatus {
    let queueLength = 0;
    let runningCount = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") queueLength++;
      else if (job.status === "dispatching" || job.status === "running") runningCount++;
    }
    return {
      queueLength,
      runningCount,
      recentCompletions: [...this.recentCompletions],
    };
  }

  shutdown(): void {
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;

    try {
      const now = Date.now();
      let runningCount = 0;
      for (const job of this.jobs.values()) {
        if (job.status === "dispatching" || job.status === "running") runningCount++;
      }

      if (runningCount >= this.maxConcurrentJobs) return;

      // Collect ready queued jobs
      const ready: SchedulerJob[] = [];
      for (const job of this.jobs.values()) {
        if (job.status === "queued" && job.nextRunAt <= now) {
          ready.push(job);
        }
      }

      // Sort by priority, then createdAt (FIFO within same priority)
      ready.sort((a, b) => {
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.createdAt - b.createdAt;
      });

      // Dispatch up to available slots
      const slotsAvailable = this.maxConcurrentJobs - runningCount;
      const toDispatch = ready.slice(0, slotsAvailable);

      for (const job of toDispatch) {
        this.dispatch(job);
      }
    } finally {
      this.pumping = false;
    }
  }

  private dispatch(job: SchedulerJob): void {
    job.status = "dispatching";
    job.attempt++;
    job.updatedAt = Date.now();

    logger.debug(`[SCHEDULER] Dispatching: ${job.kind} ${job.dedupeKey} attempt=${job.attempt}`);
    this.onAudit?.({ kind: "job_dispatched", jobId: job.id, dedupeKey: job.dedupeKey, message: `attempt ${job.attempt}` });

    job.run(job.id)
      .then(({ pid }) => {
        // Only update if still dispatching (not already marked by external)
        if (job.status === "dispatching") {
          job.status = "running";
          job.pid = pid;
          job.updatedAt = Date.now();
          logger.debug(`[SCHEDULER] Running: ${job.dedupeKey} pid=${pid}`);
        }
      })
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(`[SCHEDULER] Dispatch failed: ${job.dedupeKey}: ${msg}`);
        // Only handle if still in dispatching (not already retried/finalized)
        if (job.status === "dispatching") {
          this.markFailed(job.id, msg);
        }
      });
  }

  private finalize(job: SchedulerJob): void {
    // Remove from active maps
    this.jobs.delete(job.id);
    if (this.dedupeIndex.get(job.dedupeKey) === job.id) {
      this.dedupeIndex.delete(job.dedupeKey);
    }

    // Add to recent completions ring buffer
    this.recentCompletions.push({
      id: job.id,
      kind: job.kind,
      dedupeKey: job.dedupeKey,
      status: job.status as "completed" | "failed",
      completedAt: job.updatedAt,
      errorMessage: job.errorMessage,
    });
    while (this.recentCompletions.length > this.maxRecentCompletions) {
      this.recentCompletions.shift();
    }

    // Pump to check if queued jobs can now run
    this.pump();
  }
}
