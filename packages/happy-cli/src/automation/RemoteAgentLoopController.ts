/**
 * Remote (server-scheduled) AgentLoop controller — ADR-0022 Phase 3b.
 *
 * Today's AgentLoopCoordinator owns CLI-local loops persisted in
 * ~/.happy/agent-loops.json. This controller owns the inverse path:
 * the daemon receives an `agent-loop-trigger` ephemeral from the server,
 * dispatches the iteration through the existing AutomationScheduler
 * pipeline, and POSTs an iteration report back to the server when the
 * session terminates.
 *
 * The controller is intentionally narrow:
 *   1. translate ephemeral → AgentLoopTriggerData (internal shape)
 *   2. enqueue via scheduler (reuses AgentLoopRunner & session-spawn machinery)
 *   3. remember (jobId → callbackToken + iteration) so we can POST back
 *   4. on terminal job, fire one HTTP callback to /agent-loops/:id/iterations
 *
 * No persistence: the tracker is in-memory. A daemon restart drops in-flight
 * remote loop callbacks; the server scheduler will re-emit on the next tick,
 * relying on dedupeKey to avoid double-spawn.
 */

import type { AgentLoopTriggerEphemeral, AgentLoopIterationReport } from "@kmmao/happy-wire";
import type {
    AgentLoopTriggerData,
    AutomationJob,
    AutomationEnqueueResult,
} from "@/automation/types";

/**
 * Structural logger shape — small enough to satisfy both the singleton
 * `logger` from `@/ui/logger` and unit-test fakes without forcing the
 * full Logger class surface. All methods are optional so tests can pass
 * a partial implementation.
 */
export interface RemoteAgentLoopLogger {
    info?(message: string, ...args: unknown[]): void;
    warn?(message: string, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
}
type Logger = RemoteAgentLoopLogger;

/** Shape we need the scheduler to provide — not the full class. */
export interface RemoteAgentLoopSchedulerLike {
    enqueueAgentLoop(data: AgentLoopTriggerData): Promise<AutomationEnqueueResult>;
}

/** Shape we need the apiMachine to provide for HTTP callbacks. */
export interface RemoteAgentLoopHttpClient {
    postAgentLoopIterationReport(opts: {
        projectId: string;
        loopId: string;
        bearerToken: string;
        body: AgentLoopIterationReport;
    }): Promise<{ ok: boolean; error?: string }>;
}

/** Per-job state kept around until the job terminates. */
interface TrackedJob {
    jobId: string;
    loopId: string;
    projectId: string;
    iteration: number;
    bearerToken: string;
    createdAt: number;
}

export interface RemoteAgentLoopControllerOptions {
    scheduler: RemoteAgentLoopSchedulerLike;
    httpClient: RemoteAgentLoopHttpClient;
    logger: Logger;
    /** Auto-evict tracked entries older than this. Default 1h. */
    maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

export class RemoteAgentLoopController {
    private readonly scheduler: RemoteAgentLoopSchedulerLike;
    private readonly httpClient: RemoteAgentLoopHttpClient;
    private readonly logger: Logger;
    private readonly maxAgeMs: number;
    private readonly trackedByJobId = new Map<string, TrackedJob>();

    constructor(opts: RemoteAgentLoopControllerOptions) {
        this.scheduler = opts.scheduler;
        this.httpClient = opts.httpClient;
        this.logger = opts.logger;
        this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    }

    /**
     * Handle an `agent-loop-trigger` ephemeral from the server. Returns the
     * enqueue result so callers can react (audit log, log line, etc.).
     */
    async handleTriggerEphemeral(
        ephemeral: AgentLoopTriggerEphemeral,
    ): Promise<AutomationEnqueueResult> {
        this.evictStale();

        const data = this.toAgentLoopTriggerData(ephemeral);
        const result = await this.scheduler.enqueueAgentLoop(data);

        // We track the job even when deduped: the previous enqueue's tracking
        // entry might already exist with the same jobId, which trackJob handles
        // idempotently (replace-in-place). Without tracking a dedupe, the
        // earlier ephemeral's token may be stale (rare, but defensive).
        this.trackJob({
            jobId: result.job.id,
            loopId: ephemeral.loopId,
            projectId: ephemeral.projectId,
            iteration: ephemeral.iteration,
            bearerToken: ephemeral.callbackToken,
            createdAt: Date.now(),
        });

        this.logger.info?.(
            `[REMOTE-AGENT-LOOP] Enqueued ${result.job.id} for loop ${ephemeral.loopId} iter ${ephemeral.iteration}` +
                (result.deduped ? " (deduped)" : ""),
        );

        return result;
    }

    /**
     * Notify the controller a job has reached a terminal state. POSTs a
     * single iteration report to the server when the job is one we know
     * about; no-ops otherwise.
     *
     * `sessionId` should be the happy session id reported by the daemon at
     * session termination time. Errors during HTTP delivery are logged but
     * NOT thrown — the daemon's terminal-flow can't roll itself back.
     */
    async handleJobTerminal(opts: {
        jobId: string;
        status: "completed" | "failed" | "cancelled";
        sessionId?: string;
        errorMessage?: string;
        briefSummary?: string;
        costUsd?: number;
        tokens?: number;
    }): Promise<void> {
        const tracked = this.trackedByJobId.get(opts.jobId);
        if (!tracked) {
            return;
        }
        this.trackedByJobId.delete(opts.jobId);

        const body: AgentLoopIterationReport = {
            iteration: tracked.iteration,
            sessionId: opts.sessionId ?? null,
            status: opts.status,
            errorMessage: opts.errorMessage,
            briefSummary: opts.briefSummary,
            costUsd: opts.costUsd,
            tokens: opts.tokens,
        };

        try {
            const resp = await this.httpClient.postAgentLoopIterationReport({
                projectId: tracked.projectId,
                loopId: tracked.loopId,
                bearerToken: tracked.bearerToken,
                body,
            });
            if (!resp.ok) {
                this.logger.warn?.(
                    `[REMOTE-AGENT-LOOP] Iteration callback non-ok: loop=${tracked.loopId} iter=${tracked.iteration} err=${resp.error ?? "unknown"}`,
                );
            } else {
                this.logger.debug?.(
                    `[REMOTE-AGENT-LOOP] Reported iteration ${tracked.iteration} for loop ${tracked.loopId}`,
                );
            }
        } catch (err) {
            this.logger.warn?.(
                `[REMOTE-AGENT-LOOP] Iteration callback threw: loop=${tracked.loopId} iter=${tracked.iteration} err=${(err as Error).message}`,
            );
        }
    }

    /** Test-only helper: how many entries are currently tracked. */
    trackedCount(): number {
        return this.trackedByJobId.size;
    }

    private trackJob(entry: TrackedJob): void {
        this.trackedByJobId.set(entry.jobId, entry);
    }

    private evictStale(): void {
        const cutoff = Date.now() - this.maxAgeMs;
        for (const [jobId, entry] of this.trackedByJobId) {
            if (entry.createdAt < cutoff) {
                this.trackedByJobId.delete(jobId);
                this.logger.debug?.(
                    `[REMOTE-AGENT-LOOP] Evicted stale tracker for job ${jobId} (loop ${entry.loopId})`,
                );
            }
        }
    }

    private toAgentLoopTriggerData(
        ephemeral: AgentLoopTriggerEphemeral,
    ): AgentLoopTriggerData {
        return {
            type: "agent-loop-trigger",
            loopId: ephemeral.loopId,
            prompt: ephemeral.prompt,
            directory: ephemeral.directory,
            // intervalMs is required by the internal type but irrelevant for
            // server-driven triggers — the server already scheduled this slot.
            // Pass 0 to signal "no local rescheduling".
            intervalMs: 0,
            trigger: "schedule",
            iteration: ephemeral.iteration,
            agent: ephemeral.agent,
            modelMode: ephemeral.modelMode ?? undefined,
            effort: ephemeral.effort ?? undefined,
            profileId: ephemeral.profileId ?? undefined,
            projectId: ephemeral.projectId,
            // genericConfig is a passthrough record; surface common scalars
            // when present so the runner can read them like local loops do.
            // Anything not promoted stays inside the runtimeProfile/env vars.
            ...spreadGenericConfig(ephemeral.genericConfig),
        };
    }
}

/**
 * Pull a small subset of well-known scalar fields out of the loose
 * `genericConfig` Record into the typed AgentLoopTriggerData shape. We
 * keep the map deliberately small — the runner already reads everything
 * else from runtimeProfile / env vars and we don't want to grow this list
 * silently. Fields not promoted here still survive in the wire payload
 * (server keeps the JSON column round-tripping intact).
 */
function spreadGenericConfig(
    cfg: Record<string, unknown> | undefined,
): Partial<AgentLoopTriggerData> {
    if (!cfg) return {};
    const out: Partial<AgentLoopTriggerData> = {};
    if (typeof cfg.goal === "string") out.goal = cfg.goal;
    if (typeof cfg.currentFocus === "string") out.currentFocus = cfg.currentFocus;
    if (typeof cfg.workingMemory === "string") out.workingMemory = cfg.workingMemory;
    if (typeof cfg.lastReflectionSummary === "string") {
        out.lastReflectionSummary = cfg.lastReflectionSummary;
    }
    if (typeof cfg.cooldownMs === "number") out.cooldownMs = cfg.cooldownMs;
    if (typeof cfg.retryBackoffMs === "number") out.retryBackoffMs = cfg.retryBackoffMs;
    if (typeof cfg.quietHoursStart === "string") out.quietHoursStart = cfg.quietHoursStart;
    if (typeof cfg.quietHoursEnd === "string") out.quietHoursEnd = cfg.quietHoursEnd;
    if (typeof cfg.maxAutoRunsPerDay === "number") out.maxAutoRunsPerDay = cfg.maxAutoRunsPerDay;
    if (typeof cfg.bootstrapSlashCommand === "string") {
        out.bootstrapSlashCommand = cfg.bootstrapSlashCommand;
    }
    if (typeof cfg.freshSessionPerIteration === "boolean") {
        out.freshSessionPerIteration = cfg.freshSessionPerIteration;
    }
    if (cfg.environmentVariables && typeof cfg.environmentVariables === "object") {
        out.environmentVariables = cfg.environmentVariables as Record<string, string>;
    }
    return out;
}

// Re-export for tests; consumer modules pass the existing AutomationJob.
export type { AutomationJob };
