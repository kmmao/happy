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
  AgentLoopTriggerData,
  AutomationEnqueueResult,
  AutomationJob,
  AutomationMutationResult,
  AutomationPriority,
  AutomationRecoveryResult,
  AutomationRunResult,
  TaskTriggerData,
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
    | { kind: "webhook"; payload: WebhookTriggerData }
    | { kind: "agent_loop"; payload: AgentLoopTriggerData }
    | { kind: "task"; payload: TaskTriggerData },
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
      continuityKey:
        payload.trigger === "fix"
          ? `project:${payload.projectId}`
          : payload.loopId
            ? `loop:${payload.loopId}`
            : `project:${payload.projectId}`,
    };
  }

  if (input.kind === "agent_loop") {
    const { payload } = input;
    const promptPreview = payload.prompt.trim().replace(/\s+/g, " ").slice(0, 48);
    const baseLabel = payload.loopName ? `Agent Loop: ${payload.loopName}` : `Agent Loop: ${promptPreview}`;
    return {
      label: payload.trigger === "event" && payload.eventTitle
        ? `${baseLabel} · Event: ${payload.eventTitle}`
        : baseLabel,
      projectId: payload.projectId,
      loopId: payload.loopId,
      loopIteration: payload.iteration,
      continuityKey: `agent-loop:${payload.loopId}`,
    };
  }

  if (input.kind === "task") {
    const { payload } = input;
    const promptPreview = payload.prompt.trim().replace(/\s+/g, " ").slice(0, 48);
    return {
      label: `Task: ${promptPreview}`,
      projectId: payload.projectId,
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
  sendPushNotification?: (title: string, body: string) => void;
  onTaskStatusReport?: (taskId: string, status: string, sessionId?: string, errorMessage?: string, outcome?: "completed" | "failed" | "blocked") => void;
  /**
   * ADR-0022 Phase 3b — fires once per job reaching a terminal status.
   * The RemoteAgentLoopController subscribes here to POST iteration
   * reports back to the server. Other consumers may subscribe too — the
   * callback is invoked best-effort and any throw is logged and dropped.
   */
  onJobTerminal?: (job: AutomationJob) => void | Promise<void>;
}

export class AutomationScheduler {
  private readonly store: AutomationStore;
  private readonly runnerDeps: AutomationRunnerDeps;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrentDispatches: number;
  private readonly stopWaitMs: number;
  private readonly runJob: (job: AutomationJob) => Promise<AutomationRunResult>;
  private readonly onChange?: (jobs: AutomationJob[]) => void;
  private readonly sendPushNotification?: (title: string, body: string) => void;
  private readonly onTaskStatusReport?: (taskId: string, status: string, sessionId?: string, errorMessage?: string, outcome?: "completed" | "failed" | "blocked") => void;
  private readonly onJobTerminal?: (job: AutomationJob) => void | Promise<void>;
  private readonly inFlight = new Set<string>();
  private readonly activeDispatches = new Set<Promise<void>>();
  private interval: NodeJS.Timeout | null = null;
  private loaded = false;
  private pumpInProgress = false;
  private stopped = false;
  private _killed = false;

  constructor(options: AutomationSchedulerOptions) {
    this.store = options.store;
    this.runnerDeps = options.runnerDeps;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxConcurrentDispatches = options.maxConcurrentDispatches ?? 4;
    this.stopWaitMs = options.stopWaitMs ?? 1_000;
    this.runJob =
      options.runJob ?? ((job) => runAutomationJob(job, this.runnerDeps));
    this.onChange = options.onChange;
    this.sendPushNotification = options.sendPushNotification;
    this.onTaskStatusReport = options.onTaskStatusReport;
    this.onJobTerminal = options.onJobTerminal;
  }

  async start(recoveredRunningSessionIds?: ReadonlySet<string>): Promise<AutomationRecoveryResult> {
    await this.ensureLoaded();
    this.stopped = false;
    const recovery = await this.recover(recoveredRunningSessionIds);
    this.interval = setInterval(() => {
      void this.pump();
    }, this.pollIntervalMs);
    if (this.interval) (this.interval as NodeJS.Timeout).unref?.();
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

  async enqueueAgentLoop(
    data: AgentLoopTriggerData,
  ): Promise<AutomationEnqueueResult> {
    await this.ensureLoaded();
    return this.enqueueJob({
      kind: "agent_loop",
      payload: data,
      priority: "background",
      dedupeKey: `agent-loop:${data.loopId}:${data.iteration}`,
      maxAttempts: 3,
    });
  }

  async enqueueTask(
    data: TaskTriggerData,
  ): Promise<AutomationEnqueueResult> {
    await this.ensureLoaded();
    return this.enqueueJob({
      kind: "task",
      payload: data,
      priority: data.priority ?? "user",
      dedupeKey: `task:${data.taskId}`,
      maxAttempts: 3,
    });
  }

  getJobsSnapshot(): AutomationJob[] {
    return this.store.getAll();
  }

  /**
   * The active (non-terminal) automation job for an agent loop, if any.
   *
   * The scheduler owns job lifecycle, so it owns the definition of "active" —
   * this is the single authority for the "don't run a loop while one is already
   * running" invariant. Callers must not re-derive it by scanning
   * getJobsSnapshot(), which leaks the terminal-status semantics out of here.
   */
  getActiveJobByLoopId(loopId: string): AutomationJob | undefined {
    return this.store
      .getAll()
      .find((job) => job.loopId === loopId && !TERMINAL_STATUSES.has(job.status));
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

  async removeJob(jobId: string): Promise<AutomationMutationResult> {
    await this.ensureLoaded();
    const job = this.store.get(jobId);
    if (!job) {
      return { success: false, errorMessage: `Automation job ${jobId} not found` };
    }
    if (!TERMINAL_STATUSES.has(job.status)) {
      return { success: false, errorMessage: `Automation job ${jobId} is still ${job.status} and cannot be removed` };
    }
    await this.store.remove(job.id);
    this.notifyChange();
    logger.info(`[AUTOMATION] Removed ${job.kind} job ${job.id}`);
    return { success: true, job };
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
    const job =
      this.store
        .getAll()
        .filter((entry) => entry.sessionId === sessionId && !TERMINAL_STATUSES.has(entry.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      this.store
        .getAll()
        .filter((entry) => entry.sessionId === sessionId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
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
    this.reportTaskStatus(updated);
    // ADR-0022 Phase 3b — fire the terminal hook. Best-effort: any throw
    // from the subscriber must not roll back the scheduler's own state.
    if (this.onJobTerminal) {
      try {
        const maybePromise = this.onJobTerminal(updated);
        if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
          (maybePromise as Promise<void>).catch((err) => {
            logger.debug(`[AUTOMATION] onJobTerminal threw: ${err}`);
          });
        }
      } catch (err) {
        logger.debug(`[AUTOMATION] onJobTerminal threw sync: ${err}`);
      }
    }
    return updated;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.store.load();
    this.loaded = true;
  }

  private reportTaskStatus(job: AutomationJob): void {
    if (job.kind !== "task" || !this.onTaskStatusReport) {
      return;
    }
    const taskId = (job.payload as TaskTriggerData).taskId;
    const outcome = job.status === "completed" || job.status === "failed" || job.status === "cancelled"
      ? (job.status === "cancelled" ? "failed" : job.status)
      : undefined;
    try {
      this.onTaskStatusReport(taskId, job.status, job.sessionId, job.errorMessage, outcome);
    } catch (err) {
      logger.debug(`[AUTOMATION] Failed to report task status for ${taskId}: ${err}`);
    }
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
        }
      | {
          kind: "agent_loop";
          payload: AgentLoopTriggerData;
          priority: AutomationPriority;
          dedupeKey: string;
          maxAttempts: number;
        }
      | {
          kind: "task";
          payload: TaskTriggerData;
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

  private async recover(recoveredRunningSessionIds?: ReadonlySet<string>): Promise<AutomationRecoveryResult> {
    let retainedTerminal = 0;
    let reattachedRunning = 0;
    let cancelledOnRestart = 0;

    for (const job of this.store.getAll()) {
      if (TERMINAL_STATUSES.has(job.status)) {
        retainedTerminal++;
        continue;
      }

      if (job.sessionId && recoveredRunningSessionIds?.has(job.sessionId)) {
        const recoveredRunning: AutomationJob = {
          ...job,
          status: "running",
          completionMode: job.completionMode ?? "session",
          updatedAt: Date.now(),
        };
        await this.store.upsert(recoveredRunning);
        reattachedRunning++;
        continue;
      }

      // Pre-0.98.2 we would requeue these jobs so `pump()` re-dispatched
      // them immediately. That meant every daemon restart could trigger a
      // flurry of fresh session spawns for in-flight loop / supervisor /
      // task work — visually "5 ghost sessions appear under the workflow
      // card the moment daemon restarts". We now mark them cancelled and
      // let the next scheduler tick (cron interval or external trigger)
      // do the re-trigger naturally. agent_loop / supervisor recover on
      // their next tick within minutes; task / webhook trigger work that
      // was actually in flight is lost — same semantics as a server-side
      // crash in the middle of a request.
      const cancelled: AutomationJob = {
        ...job,
        status: "cancelled",
        sessionId: undefined,
        completionMode: undefined,
        errorMessage:
          job.errorMessage ??
          "Cancelled at daemon restart — next scheduler tick will re-trigger naturally",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.store.upsert(cancelled);
      cancelledOnRestart++;
    }

    if (cancelledOnRestart > 0) {
      logger.info(
        `[AUTOMATION] Cancelled ${cancelledOnRestart} in-flight job(s) at daemon restart; next scheduler tick will re-trigger them naturally`,
      );
      try {
        this.sendPushNotification?.(
          "Automation Recovery",
          `${cancelledOnRestart} in-flight task(s) cancelled at daemon restart; the next scheduled tick will re-trigger them`,
        );
      } catch {
        // best-effort notification
      }
    }
    if (reattachedRunning > 0) {
      logger.info(
        `[AUTOMATION] Reattached ${reattachedRunning} running job(s) to live sessions after daemon restart`,
      );
    }

    return {
      requeued: 0,
      retainedTerminal,
      reattachedRunning,
      cancelledOnRestart,
    };
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
        const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (byPriority !== 0) return byPriority;
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id.localeCompare(b.id);
      });
  }

  get killed(): boolean {
    return this._killed;
  }

  setKilled(value: boolean): void {
    this._killed = value;
  }

  private async pump(): Promise<void> {
    if (this.stopped || this._killed || this.pumpInProgress) {
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
      const current = this.store.get(job.id);
      if (current && TERMINAL_STATUSES.has(current.status)) {
        return;
      }
      if (result.completion === "session") {
        const running: AutomationJob = {
          ...started,
          status: "running",
          updatedAt: Date.now(),
          sessionId: result.sessionId,
          completionMode: result.completion,
        };
        await this.store.upsert(running);
        this.notifyChange();
        this.reportTaskStatus(running);
        logger.info(result.sessionId
          ? `[AUTOMATION] ${job.kind} job ${job.id} is now running in session ${result.sessionId}`
          : `[AUTOMATION] ${job.kind} job ${job.id} is running (session id pending)`);
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
      this.reportTaskStatus(completed);
      logger.info(`[AUTOMATION] Completed ${job.kind} job ${job.id}`);
    } catch (error) {
      const current = this.store.get(job.id);
      if (current && TERMINAL_STATUSES.has(current.status)) {
        return;
      }
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
      if (!canRetry) {
        this.reportTaskStatus(failed);
      }
      logger.debug(
        `[AUTOMATION] ${canRetry ? "Retrying" : "Failed"} ${job.kind} job ${job.id}: ${errorMessage}`,
      );
    }
  }
}
