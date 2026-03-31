import { randomUUID } from "node:crypto";
import { logger } from "@/ui/logger";
import type {
  SupervisorTriggerData,
  WebhookTriggerData,
} from "@/api/apiMachine";
import { AutomationStore } from "./AutomationStore";
import {
  runAutomationJob,
  type AutomationRunnerDeps,
} from "./AutomationRunner";
import type {
  AutomationEnqueueResult,
  AutomationJob,
  AutomationMutationResult,
  AutomationPriority,
  AutomationRecoveryResult,
  AutomationRunResult,
} from "./types";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PRIORITY_ORDER: Record<AutomationPriority, number> = {
  urgent: 0,
  user: 1,
  background: 2,
};

function buildAutomationJobMetadata(
  input:
    | { kind: "supervisor"; payload: SupervisorTriggerData }
    | { kind: "webhook"; payload: WebhookTriggerData },
): Pick<AutomationJob, "label" | "projectId" | "runId" | "loopId" | "loopIteration" | "continuityKey"> {
  if (input.kind === "supervisor") {
    const { payload } = input;
    let label = `Supervisor ${payload.trigger}`;
    if (payload.trigger === "fix" && payload.fixAction?.title) {
      label = `Supervisor fix: ${payload.fixAction.title}`;
    } else if (payload.trigger === "research") {
      label = "Supervisor research";
    } else if (payload.loopIteration != null) {
      label = `Supervisor loop #${payload.loopIteration}`;
    }
    return {
      label,
      projectId: payload.projectId,
      runId: payload.runId,
      loopId: payload.loopId,
      loopIteration: payload.loopIteration,
      continuityKey: payload.trigger === "fix" ? `project:${payload.projectId}` : (payload.loopId ? `loop:${payload.loopId}` : `project:${payload.projectId}`),
    };
  }

  return {
    label: `Issue #${input.payload.issueNumber}: ${input.payload.issueTitle}`,
  };
}

export interface AutomationSchedulerOptions {
  store: AutomationStore;
  runnerDeps: AutomationRunnerDeps;
  pollIntervalMs?: number;
  maxConcurrentDispatches?: number;
  stopWaitMs?: number;
  runJob?: (job: AutomationJob) => Promise<AutomationRunResult>;
  onChange?: (jobs: AutomationJob[]) => void;
}

export class AutomationScheduler {
  private readonly store: AutomationStore;
  private readonly runnerDeps: AutomationRunnerDeps;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentDispatches: number;
  private readonly stopWaitMs: number;
  private readonly runJob: (job: AutomationJob) => Promise<AutomationRunResult>;
  private readonly onChange?: (jobs: AutomationJob[]) => void;
  private readonly inFlight = new Set<string>();
  private readonly activeDispatches = new Set<Promise<void>>();
  private interval: NodeJS.Timeout | null = null;
  private loaded = false;
  private pumpInProgress = false;
  private stopped = false;

  constructor(options: AutomationSchedulerOptions) {
    this.store = options.store;
    this.runnerDeps = options.runnerDeps;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxConcurrentDispatches = options.maxConcurrentDispatches ?? 4;
    this.stopWaitMs = options.stopWaitMs ?? 1_000;
    this.runJob =
      options.runJob ?? ((job) => runAutomationJob(job, this.runnerDeps));
    this.onChange = options.onChange;
  }

  async start(): Promise<AutomationRecoveryResult> {
    await this.ensureLoaded();
    this.stopped = false;
    const recovery = await this.recover();
    this.interval = setInterval(() => {
      void this.pump();
    }, this.pollIntervalMs);
    this.notifyChange();
    void this.pump();
    return recovery;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.activeDispatches.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.activeDispatches]),
        new Promise((resolve) => setTimeout(resolve, this.stopWaitMs)),
      ]);
      if (this.activeDispatches.size > 0) {
        logger.debug(
          `[AUTOMATION] stop() timed out with ${this.activeDispatches.size} active dispatch(es) still pending`,
        );
      }
    }
  }

  async enqueueSupervisor(
    data: SupervisorTriggerData,
  ): Promise<AutomationEnqueueResult> {
    await this.ensureLoaded();
    const priority: AutomationPriority =
      data.trigger === "fix" ? "urgent" : "background";
    return this.enqueueJob({
      kind: "supervisor",
      payload: data,
      priority,
      dedupeKey: `supervisor:${data.runId}`,
      maxAttempts: 3,
    });
  }

  async enqueueWebhook(
    data: WebhookTriggerData,
  ): Promise<AutomationEnqueueResult> {
    await this.ensureLoaded();
    return this.enqueueJob({
      kind: "webhook",
      payload: data,
      priority: "background",
      dedupeKey: `webhook:${data.webhookEventId}`,
      maxAttempts: 3,
    });
  }

  getJobsSnapshot(): AutomationJob[] {
    return this.store.getAll();
  }

  async cancelJob(jobId: string): Promise<AutomationMutationResult> {
    await this.ensureLoaded();
    const job = this.store.get(jobId);
    if (!job) {
      return { success: false, errorMessage: `Automation job ${jobId} not found` };
    }
    if (this.inFlight.has(jobId) || job.status === "dispatching") {
      return {
        success: false,
        errorMessage: `Automation job ${jobId} is already dispatching and cannot be cancelled`,
        job,
      };
    }
    if (job.status === "cancelled") {
      return { success: true, job };
    }
    if (job.status === "running") {
      return {
        success: false,
        errorMessage: `Automation job ${jobId} is already running; cancel the underlying session instead`,
        job,
      };
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      return {
        success: false,
        errorMessage: `Automation job ${jobId} is already ${job.status}`,
        job,
      };
    }

    const cancelled: AutomationJob = {
      ...job,
      status: "cancelled",
      updatedAt: Date.now(),
      nextRunAt: undefined,
      completedAt: Date.now(),
      errorMessage:
        job.errorMessage ?? "Cancelled from happy daemon automation cancel",
    };
    await this.store.upsert(cancelled);
    this.notifyChange();
    logger.info(`[AUTOMATION] Cancelled ${job.kind} job ${job.id}`);
    return { success: true, job: cancelled };
  }

  async retryJob(jobId: string): Promise<AutomationMutationResult> {
    await this.ensureLoaded();
    const job = this.store.get(jobId);
    if (!job) {
      return { success: false, errorMessage: `Automation job ${jobId} not found` };
    }
    if (this.inFlight.has(jobId) || job.status === "dispatching") {
      return {
        success: false,
        errorMessage: `Automation job ${jobId} is already dispatching and cannot be retried`,
        job,
      };
    }
    if (job.status === "running") {
      return {
        success: false,
        errorMessage: `Automation job ${jobId} is already running and cannot be retried`,
        job,
      };
    }

    const retried: AutomationJob = {
      ...job,
      status: "queued",
      attempt: 0,
      updatedAt: Date.now(),
      nextRunAt: undefined,
      dispatchedAt: undefined,
      completedAt: undefined,
      sessionId: undefined,
      completionMode: undefined,
      errorMessage: undefined,
    };
    await this.store.upsert(retried);
    this.notifyChange();
    logger.info(`[AUTOMATION] Re-queued ${job.kind} job ${job.id}`);
    void this.pump();
    return { success: true, job: retried };
  }

  async clearTerminalJobs(): Promise<AutomationMutationResult> {
    await this.ensureLoaded();
    const jobs = this.store.getAll().filter((job) => TERMINAL_STATUSES.has(job.status));
    for (const job of jobs) {
      await this.store.remove(job.id);
    }
    this.notifyChange();
    return { success: true };
  }

  async markJobTerminalByDedupeKey(
    dedupeKey: string,
    status: "completed" | "failed" | "cancelled",
    errorMessage?: string,
  ): Promise<AutomationJob | undefined> {
    await this.ensureLoaded();
    const job = this.store.getAll().find((entry) => entry.dedupeKey === dedupeKey);
    if (!job) {
      return undefined;
    }
    return this.markTerminal(job, status, errorMessage);
  }

  async markJobTerminalBySession(
    sessionId: string,
    status: "completed" | "failed" | "cancelled",
    errorMessage?: string,
  ): Promise<AutomationJob | undefined> {
    await this.ensureLoaded();
    const job = this.store
      .getAll()
      .filter((entry) => entry.sessionId === sessionId && !TERMINAL_STATUSES.has(entry.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      ?? this.store.getAll().filter((entry) => entry.sessionId === sessionId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!job) {
      return undefined;
    }
    return this.markTerminal(job, status, errorMessage);
  }

  private async markTerminal(
    job: AutomationJob,
    status: "completed" | "failed" | "cancelled",
    errorMessage?: string,
  ): Promise<AutomationJob> {
    if (TERMINAL_STATUSES.has(job.status)) {
      return job;
    }
    const updated: AutomationJob = {
      ...job,
      status,
      updatedAt: Date.now(),
      completedAt: Date.now(),
      errorMessage: errorMessage ?? (status === "completed" ? undefined : job.errorMessage),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    return updated;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.store.load();
    this.loaded = true;
  }

  private notifyChange(): void {
    if (!this.onChange) {
      return;
    }
    try {
      this.onChange(this.store.getAll());
    } catch (error) {
      logger.debug("[AUTOMATION] Failed to publish scheduler change", error);
    }
  }

  private async enqueueJob(
    input:
      | {
          kind: "supervisor";
          payload: SupervisorTriggerData;
          priority: AutomationPriority;
          dedupeKey: string;
          maxAttempts: number;
        }
      | {
          kind: "webhook";
          payload: WebhookTriggerData;
          priority: AutomationPriority;
          dedupeKey: string;
          maxAttempts: number;
        },
  ): Promise<AutomationEnqueueResult> {
    const active = this.store.findActiveByDedupeKey(input.dedupeKey);
    if (active) {
      logger.debug(
        `[AUTOMATION] Dedupe hit for ${input.dedupeKey}, keeping job ${active.id} (${active.status})`,
      );
      return { job: active, deduped: true };
    }

    const now = Date.now();
    const job: AutomationJob = {
      id: randomUUID(),
      kind: input.kind,
      status: "queued",
      priority: input.priority,
      dedupeKey: input.dedupeKey,
      attempt: 0,
      maxAttempts: input.maxAttempts,
      createdAt: now,
      updatedAt: now,
      ...buildAutomationJobMetadata(input),
      payload: input.payload,
    } as AutomationJob;

    await this.store.upsert(job);
    this.notifyChange();
    logger.debug(
      `[AUTOMATION] Enqueued ${job.kind} job ${job.id} (${job.dedupeKey})`,
    );
    void this.pump();
    return { job, deduped: false };
  }

  private async recover(): Promise<AutomationRecoveryResult> {
    let requeued = 0;
    let retainedTerminal = 0;

    for (const job of this.store.getAll()) {
      if (TERMINAL_STATUSES.has(job.status)) {
        retainedTerminal++;
        continue;
      }

      const recovered: AutomationJob = {
        ...job,
        status: "queued",
        sessionId: undefined,
        completionMode: undefined,
        errorMessage:
          job.errorMessage ??
          "Recovered after daemon restart before automation outcome was finalized",
        updatedAt: Date.now(),
      };
      await this.store.upsert(recovered);
      requeued++;
    }

    if (requeued > 0) {
      logger.info(
        `[AUTOMATION] Recovered ${requeued} queued job(s) from previous daemon run`,
      );
    }

    return { requeued, retainedTerminal };
  }

  private isReady(job: AutomationJob, now: number): boolean {
    if (job.status !== "queued") return false;
    if (job.nextRunAt && job.nextRunAt > now) return false;
    return true;
  }

  private pickReadyJobs(): AutomationJob[] {
    const now = Date.now();
    return this.store
      .getAll()
      .filter((job) => this.isReady(job, now) && !this.inFlight.has(job.id))
      .sort((a, b) => {
        const byPriority =
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (byPriority !== 0) return byPriority;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.pumpInProgress) {
      return;
    }
    this.pumpInProgress = true;
    try {
      while (!this.stopped && this.inFlight.size < this.maxConcurrentDispatches) {
        const next = this.pickReadyJobs()[0];
        if (!next) {
          break;
        }
        this.inFlight.add(next.id);
        const dispatchPromise = this.dispatch(next).finally(() => {
          this.inFlight.delete(next.id);
          this.activeDispatches.delete(dispatchPromise);
          void this.pump();
        });
        this.activeDispatches.add(dispatchPromise);
      }
    } finally {
      this.pumpInProgress = false;
    }
  }

  private async dispatch(job: AutomationJob): Promise<void> {
    const started: AutomationJob = {
      ...job,
      status: "dispatching",
      attempt: job.attempt + 1,
      dispatchedAt: Date.now(),
      updatedAt: Date.now(),
      errorMessage: undefined,
    };
    await this.store.upsert(started);
    this.notifyChange();
    logger.info(
      `[AUTOMATION] Dispatching ${job.kind} job ${job.id} (attempt ${started.attempt}/${started.maxAttempts})`,
    );

    try {
      const result = await this.runJob(started);
      if (result.completion === "session" && result.sessionId) {
        const running: AutomationJob = {
          ...started,
          status: "running",
          updatedAt: Date.now(),
          sessionId: result.sessionId,
          completionMode: result.completion,
        };
        await this.store.upsert(running);
        this.notifyChange();
        logger.info(
          `[AUTOMATION] ${job.kind} job ${job.id} is now running in session ${result.sessionId}`,
        );
        return;
      }

      const completed: AutomationJob = {
        ...started,
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
        completionMode: result.completion,
      };
      await this.store.upsert(completed);
      this.notifyChange();
      logger.info(`[AUTOMATION] Completed ${job.kind} job ${job.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const canRetry = started.attempt < started.maxAttempts;
      const failed: AutomationJob = {
        ...started,
        status: canRetry ? "queued" : "failed",
        nextRunAt: canRetry ? Date.now() + started.attempt * 5_000 : undefined,
        updatedAt: Date.now(),
        errorMessage,
      };
      await this.store.upsert(failed);
      this.notifyChange();
      logger.debug(
        `[AUTOMATION] ${canRetry ? "Retrying" : "Failed"} ${job.kind} job ${job.id}: ${errorMessage}`,
      );
    }
  }
}
