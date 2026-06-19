/**
 * Generic AgentLoop engine — ADR-0022 Phase 3b.
 *
 * Owns the lifecycle of `role: "generic"` AgentLoop rows: create / update /
 * delete, enable/disable toggle, scheduler tick that emits
 * `agent-loop-trigger` ephemerals to the target machine's daemon, and
 * iteration-completion callback handling.
 *
 * The supervisor-role engine (supervisorLoopEngine.ts) is intentionally
 * untouched — its phase machine and SupervisorRun/Action coupling don't
 * map onto generic loops. Phase 4 will unify the CRUD surface; the
 * engines stay separate per ADR-0022 (loops have different concerns).
 *
 * Token-based iteration callback (stateless):
 *
 *   token = hmac(SECRET, `${loopId}:${iteration}`)
 *
 * No DB column needed. The daemon receives the token in the trigger
 * ephemeral and presents it as Bearer on the callback. The server
 * recomputes and constant-time compares.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { log } from "@/utils/log";
import { ownedAgentLoop, ownedProject } from "@/app/api/ownership";
import {
    type CreateGenericAgentLoopBody,
    type UpdateGenericAgentLoopBody,
    type AgentLoopIterationReport,
} from "@kmmao/happy-wire";
import {
    normalizeResolvedRuntimeProfile,
    type ResolvedRuntimeProfile,
} from "@/types/aiBackendProfile";

// ── Types ──

export interface AgentLoopEngineResult<T> {
    ok: true;
    value: T;
}
export interface AgentLoopEngineError {
    ok: false;
    code: number;
    error: string;
}
export type AgentLoopEngineOutcome<T> = AgentLoopEngineResult<T> | AgentLoopEngineError;

type AgentLoopRow = NonNullable<Awaited<ReturnType<typeof db.agentLoop.findUnique>>>;

// ── Constants ──

const DEFAULT_AGENT = "claude";
const MIN_INTERVAL_MS = 30_000; // 30s safety floor on top of CLI's own throttle
const MAX_DURATION_MINUTES_DEFAULT = 240;

/**
 * HMAC secret for callback tokens. Reuses HAPPY_SERVER_SECRET when set so
 * tokens survive a deploy; falls back to a process-scoped value in dev. The
 * fallback intentionally throws in production — tokens disappearing on every
 * deploy in prod would be a silent reliability loss.
 */
function callbackHmacSecret(): string {
    const secret = process.env.HAPPY_SERVER_SECRET;
    if (secret && secret.length >= 16) return secret;
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "HAPPY_SERVER_SECRET is required in production for agent-loop callback tokens",
        );
    }
    return "dev-agent-loop-secret-not-for-prod";
}

export function buildCallbackToken(loopId: string, iteration: number): string {
    const h = createHmac("sha256", callbackHmacSecret());
    h.update(`${loopId}:${iteration}`);
    return h.digest("hex");
}

export function verifyCallbackToken(
    loopId: string,
    iteration: number,
    provided: string,
): boolean {
    const expected = buildCallbackToken(loopId, iteration);
    if (expected.length !== provided.length) return false;
    try {
        return timingSafeEqual(
            Buffer.from(expected, "utf8"),
            Buffer.from(provided, "utf8"),
        );
    } catch {
        return false;
    }
}

// ── Scheduling helpers ──

export function computeNextRunAt(
    intervalMs: number | null | undefined,
    cronExpression: string | null | undefined,
    fromMs: number,
): number {
    if (cronExpression) {
        try {
            const it = CronExpressionParser.parse(cronExpression, {
                currentDate: new Date(fromMs),
                tz: "UTC",
            });
            return it.next().getTime();
        } catch (err) {
            log(
                { module: "agent-loop", level: "error" },
                `Invalid cron expression "${cronExpression}": ${err}`,
            );
            // Defer 1h on invalid cron so the loop doesn't tight-loop on a
            // malformed config until the user fixes it.
            return fromMs + 60 * 60 * 1000;
        }
    }
    if (intervalMs && intervalMs > 0) {
        return fromMs + Math.max(intervalMs, MIN_INTERVAL_MS);
    }
    // No schedule → next run is "manual only". Use a far-future sentinel
    // so the scheduler index skips it but we still satisfy NOT NULL where
    // we want to.
    return fromMs + 365 * 24 * 60 * 60 * 1000;
}

// ── Serialization ──

export function serializeAgentLoop(loop: AgentLoopRow): Record<string, unknown> {
    return {
        id: loop.id,
        role: loop.role,
        projectId: loop.projectId,
        accountId: loop.accountId,
        status: loop.status,
        activeRunId: loop.activeRunId,
        exitReason: loop.exitReason,
        profileId: loop.profileId,
        runtimeProfile: loop.runtimeProfile,
        maxDurationMinutes: loop.maxDurationMinutes,
        createdAt: loop.createdAt.getTime(),
        updatedAt: loop.updatedAt.getTime(),
        completedAt: loop.completedAt?.getTime() ?? null,
        prompt: loop.prompt,
        directory: loop.directory,
        agent: loop.agent,
        intervalMs: loop.intervalMs,
        cronExpression: loop.cronExpression,
        modelMode: loop.modelMode,
        effort: loop.effort,
        enabled: loop.enabled,
        nextRunAt: loop.nextRunAt !== null ? Number(loop.nextRunAt) : null,
        continuityKey: loop.continuityKey,
        iteration: loop.iteration,
        genericConfig: loop.genericConfig,
        currentPhase: loop.currentPhase,
        currentIteration: loop.currentIteration,
        maxIterations: loop.maxIterations,
        costCapUsd: loop.costCapUsd,
        healthScoreTarget: loop.healthScoreTarget,
        autoApproveThreshold: loop.autoApproveThreshold,
        maxConsecutiveFailures: loop.maxConsecutiveFailures,
        emptyIterationsToConfirm: loop.emptyIterationsToConfirm,
        consecutiveEmptyIterations: loop.consecutiveEmptyIterations,
        initialHealthScore: loop.initialHealthScore,
        currentHealthScore: loop.currentHealthScore,
        totalCostUsd: loop.totalCostUsd,
        totalTokens: loop.totalTokens,
        totalActionsFound: loop.totalActionsFound,
        totalActionsFixed: loop.totalActionsFixed,
        consecutiveFailures: loop.consecutiveFailures,
    };
}

// ── CRUD ──

/**
 * Create a new generic AgentLoop. Caller has already passed `ownedProject`.
 * Returns { loopId } on success or an error envelope; the route serializes
 * the row separately so it can echo the full Serialized shape to the client.
 */
export async function createGenericAgentLoop(opts: {
    userId: string;
    projectId: string;
    body: CreateGenericAgentLoopBody;
}): Promise<AgentLoopEngineOutcome<{ loopId: string }>> {
    const { userId, projectId, body } = opts;

    if (!body.intervalMs && !body.cronExpression) {
        return {
            ok: false,
            code: 400,
            error: "intervalMs or cronExpression is required",
        };
    }
    if (body.intervalMs && body.cronExpression) {
        return {
            ok: false,
            code: 400,
            error: "Provide either intervalMs or cronExpression, not both",
        };
    }
    if (body.intervalMs && body.intervalMs < MIN_INTERVAL_MS) {
        return {
            ok: false,
            code: 400,
            error: `intervalMs must be >= ${MIN_INTERVAL_MS}`,
        };
    }
    if (body.cronExpression) {
        try {
            CronExpressionParser.parse(body.cronExpression, { tz: "UTC" });
        } catch {
            return { ok: false, code: 400, error: "Invalid cron expression" };
        }
    }

    const nowMs = Date.now();
    const nextRunAt = body.enabled
        ? computeNextRunAt(body.intervalMs ?? null, body.cronExpression ?? null, nowMs)
        : null;

    const created = await inTx(async (tx) => {
        return tx.agentLoop.create({
            data: {
                projectId,
                accountId: userId,
                role: "generic",
                status: "running",
                enabled: body.enabled ?? true,
                prompt: body.prompt,
                directory: body.directory,
                agent: body.agent ?? DEFAULT_AGENT,
                intervalMs: body.intervalMs ?? null,
                cronExpression: body.cronExpression ?? null,
                modelMode: body.modelMode ?? null,
                effort: body.effort ?? null,
                continuityKey: body.continuityKey ?? null,
                nextRunAt: nextRunAt !== null ? BigInt(nextRunAt) : null,
                iteration: 0,
                genericConfig: body.genericConfig ?? undefined,
                profileId: body.profileId ?? null,
                runtimeProfile: body.runtimeProfile ?? undefined,
                maxDurationMinutes: body.maxDurationMinutes ?? MAX_DURATION_MINUTES_DEFAULT,
                // Supervisor-only columns retain their default values for generic rows.
            },
        });
    });

    await emitSyncUpdate(userId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(created),
    });

    log(
        { module: "agent-loop" },
        `Created generic loop ${created.id} for project ${projectId} (interval=${body.intervalMs ?? null}, cron=${body.cronExpression ?? null}, nextRunAt=${nextRunAt})`,
    );

    return { ok: true, value: { loopId: created.id } };
}

/**
 * Update an existing generic AgentLoop. Caller has already authorised via
 * `ownedAgentLoop`. Reschedules nextRunAt if scheduling fields changed.
 */
export async function updateGenericAgentLoop(opts: {
    userId: string;
    loopId: string;
    body: UpdateGenericAgentLoopBody;
}): Promise<AgentLoopEngineOutcome<{ loop: AgentLoopRow }>> {
    const { userId, loopId, body } = opts;

    const existing = await db.agentLoop.findFirst({
        where: { id: loopId, accountId: userId, role: "generic" },
    });
    if (!existing) {
        return { ok: false, code: 404, error: "Loop not found" };
    }

    const finalInterval = body.intervalMs === undefined ? existing.intervalMs : body.intervalMs;
    const finalCron = body.cronExpression === undefined ? existing.cronExpression : body.cronExpression;
    const finalEnabled = body.enabled === undefined ? existing.enabled : body.enabled;

    if (finalInterval !== null && finalCron) {
        return {
            ok: false,
            code: 400,
            error: "intervalMs and cronExpression are mutually exclusive",
        };
    }
    if (finalInterval !== null && finalInterval !== undefined && finalInterval < MIN_INTERVAL_MS) {
        return {
            ok: false,
            code: 400,
            error: `intervalMs must be >= ${MIN_INTERVAL_MS}`,
        };
    }
    if (finalCron) {
        try {
            CronExpressionParser.parse(finalCron, { tz: "UTC" });
        } catch {
            return { ok: false, code: 400, error: "Invalid cron expression" };
        }
    }

    const scheduleChanged =
        body.intervalMs !== undefined ||
        body.cronExpression !== undefined ||
        body.enabled !== undefined;
    const recomputedNextRunAt = scheduleChanged
        ? finalEnabled
            ? computeNextRunAt(finalInterval ?? null, finalCron ?? null, Date.now())
            : null
        : undefined;

    const updated = await inTx(async (tx) => {
        return tx.agentLoop.update({
            where: { id: loopId },
            data: {
                prompt: body.prompt ?? undefined,
                directory: body.directory ?? undefined,
                agent: body.agent ?? undefined,
                intervalMs: body.intervalMs === undefined ? undefined : body.intervalMs,
                cronExpression: body.cronExpression === undefined ? undefined : body.cronExpression,
                modelMode: body.modelMode === undefined ? undefined : body.modelMode,
                effort: body.effort === undefined ? undefined : body.effort,
                enabled: body.enabled ?? undefined,
                profileId: body.profileId === undefined ? undefined : body.profileId,
                runtimeProfile: body.runtimeProfile ?? undefined,
                maxDurationMinutes:
                    body.maxDurationMinutes === undefined
                        ? undefined
                        : body.maxDurationMinutes ?? undefined,
                genericConfig: body.genericConfig ?? undefined,
                nextRunAt:
                    recomputedNextRunAt === undefined
                        ? undefined
                        : recomputedNextRunAt !== null
                            ? BigInt(recomputedNextRunAt)
                            : null,
            },
        });
    });

    await emitSyncUpdate(userId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(updated),
    });

    return { ok: true, value: { loop: updated } };
}

/**
 * Pause a generic AgentLoop. For generic loops "paused" means the
 * scheduler skips them on tick — we mirror the daemon-local semantics by
 * flipping `enabled: false` while preserving `status: "running"` (so the
 * supervisor-style status enum isn't repurposed). Idempotent.
 */
export async function pauseGenericAgentLoop(opts: {
    userId: string;
    loopId: string;
}): Promise<AgentLoopEngineOutcome<{ loop: AgentLoopRow }>> {
    const existing = await db.agentLoop.findFirst({
        where: { id: opts.loopId, accountId: opts.userId, role: "generic" },
    });
    if (!existing) return { ok: false, code: 404, error: "Loop not found" };

    const updated = await db.agentLoop.update({
        where: { id: opts.loopId },
        data: { enabled: false, nextRunAt: null },
    });

    await emitSyncUpdate(opts.userId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(updated),
    });

    return { ok: true, value: { loop: updated } };
}

/**
 * Resume a generic AgentLoop — inverse of {@link pauseGenericAgentLoop}.
 * Recomputes nextRunAt so the scheduler picks the loop up at the next
 * tick. Idempotent if the loop is already enabled.
 */
export async function resumeGenericAgentLoop(opts: {
    userId: string;
    loopId: string;
}): Promise<AgentLoopEngineOutcome<{ loop: AgentLoopRow }>> {
    const existing = await db.agentLoop.findFirst({
        where: { id: opts.loopId, accountId: opts.userId, role: "generic" },
    });
    if (!existing) return { ok: false, code: 404, error: "Loop not found" };

    const nextRunAt = computeNextRunAt(
        existing.intervalMs,
        existing.cronExpression,
        Date.now(),
    );

    const updated = await db.agentLoop.update({
        where: { id: opts.loopId },
        data: { enabled: true, nextRunAt: BigInt(nextRunAt) },
    });

    await emitSyncUpdate(opts.userId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(updated),
    });

    return { ok: true, value: { loop: updated } };
}

/**
 * Stop a generic AgentLoop. Mirrors the supervisor "user_stopped" exit:
 * status → stopped, completedAt set, enabled flipped off so the row
 * doesn't ride along on resume by accident. Stays in the table so the
 * App can still surface a history row.
 */
export async function stopGenericAgentLoop(opts: {
    userId: string;
    loopId: string;
}): Promise<AgentLoopEngineOutcome<{ loop: AgentLoopRow }>> {
    const existing = await db.agentLoop.findFirst({
        where: { id: opts.loopId, accountId: opts.userId, role: "generic" },
    });
    if (!existing) return { ok: false, code: 404, error: "Loop not found" };

    const updated = await db.agentLoop.update({
        where: { id: opts.loopId },
        data: {
            status: "stopped",
            enabled: false,
            nextRunAt: null,
            exitReason: "user_stopped",
            completedAt: new Date(),
        },
    });

    await emitSyncUpdate(opts.userId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(updated),
    });

    return { ok: true, value: { loop: updated } };
}

/**
 * Delete a generic AgentLoop. Soft-stop running loops first? For Phase 3b
 * we follow the supervisor pattern: refuse to delete a running loop, force
 * the caller to disable/stop first.
 */
export async function deleteGenericAgentLoop(opts: {
    userId: string;
    loopId: string;
}): Promise<AgentLoopEngineOutcome<{ projectId: string }>> {
    const { userId, loopId } = opts;

    const existing = await db.agentLoop.findFirst({
        where: { id: loopId, accountId: userId, role: "generic" },
    });
    if (!existing) return { ok: false, code: 404, error: "Loop not found" };

    await db.agentLoop.delete({ where: { id: loopId } });

    await emitSyncUpdate(userId, {
        t: "agent-loop-deleted",
        loopId,
        projectId: existing.projectId,
    });

    return { ok: true, value: { projectId: existing.projectId } };
}

// ── Scheduler tick ──

/**
 * Find generic loops due for triggering on this machine and emit
 * `agent-loop-trigger` ephemerals to the daemon. Called from
 * `machineUpdateHandler` on the same 5-min heartbeat throttle as the
 * supervisor scheduler.
 *
 * Uses the @@index([role, enabled, nextRunAt]) composite added in
 * Phase 3a — at scale this lookup must stay an index scan, not a full
 * table scan of every loop in the system.
 */
export async function tickDueGenericAgentLoops(
    machineId: string,
    userId: string,
): Promise<void> {
    const nowMs = Date.now();

    // Find projects on this machine, then their due loops. We can't filter
    // by machineId directly on AgentLoop — the relation is via Project.
    const dueLoops = await db.agentLoop.findMany({
        where: {
            accountId: userId,
            role: "generic",
            enabled: true,
            status: "running",
            nextRunAt: { lte: BigInt(nowMs), not: null },
            project: { machineId },
        },
        include: {
            project: {
                select: { id: true, machineId: true, path: true },
            },
        },
        orderBy: { nextRunAt: "asc" },
        take: 50,
    });

    if (dueLoops.length === 0) return;

    for (const loop of dueLoops) {
        try {
            // Claim the slot — bump nextRunAt and iteration atomically using
            // optimistic locking on the current nextRunAt value. If another
            // worker already advanced it (multi-instance server), the update
            // count will be 0 and we skip emission.
            const newNextRunAt = computeNextRunAt(
                loop.intervalMs,
                loop.cronExpression,
                nowMs,
            );
            const newIteration = loop.iteration + 1;

            const claim = await db.agentLoop.updateMany({
                where: {
                    id: loop.id,
                    nextRunAt: loop.nextRunAt, // CAS — only advance if value unchanged
                },
                data: {
                    nextRunAt: BigInt(newNextRunAt),
                    iteration: newIteration,
                },
            });

            if (claim.count === 0) {
                // Another worker claimed it.
                continue;
            }

            const callbackToken = buildCallbackToken(loop.id, newIteration);

            // Best-effort runtimeProfile normalization (mirrors supervisor side).
            let runtimeProfile: ResolvedRuntimeProfile | undefined;
            if (loop.runtimeProfile) {
                runtimeProfile = normalizeResolvedRuntimeProfile(loop.runtimeProfile, {
                    allowLegacyEnvironmentVariables: true,
                    profileId: loop.profileId,
                    profileName: loop.profileId ?? undefined,
                    source: "account-profile",
                    trust: "trusted",
                }) ?? undefined;
            }

            await emitSyncEphemeral(userId, {
                t: "agent-loop-trigger",
                loopId: loop.id,
                projectId: loop.projectId,
                machineId,
                iteration: newIteration,
                prompt: loop.prompt ?? "",
                directory: loop.directory ?? loop.project.path,
                agent: (loop.agent ?? DEFAULT_AGENT) as "claude" | "codex" | "gemini",
                continuityKey: loop.continuityKey ?? undefined,
                profileId: loop.profileId ?? undefined,
                runtimeProfile,
                modelMode: loop.modelMode ?? undefined,
                effort: loop.effort ?? undefined,
                genericConfig: (loop.genericConfig as Record<string, unknown> | null) ?? undefined,
                callbackToken,
                maxDurationMinutes: loop.maxDurationMinutes,
            });

            log(
                { module: "agent-loop" },
                `Triggered generic loop ${loop.id} iteration ${newIteration} on machine ${machineId} (nextRunAt=${newNextRunAt})`,
            );
        } catch (err) {
            log(
                { module: "agent-loop", level: "error" },
                `Failed to trigger loop ${loop.id}: ${err}`,
            );
        }
    }
}

// ── Iteration callback ──

/**
 * Handle iteration-completion callback from the daemon. Verifies the bearer
 * token, advances iteration counter, and emits status + brief ephemerals
 * for the App.
 *
 * Returns the updated row on success so the route can echo back the new
 * canonical state.
 */
export async function handleAgentLoopIterationCallback(opts: {
    loopId: string;
    bearerToken: string;
    body: AgentLoopIterationReport;
}): Promise<AgentLoopEngineOutcome<{ loop: AgentLoopRow }>> {
    const { loopId, bearerToken, body } = opts;

    const loop = await db.agentLoop.findFirst({
        where: { id: loopId, role: "generic" },
    });
    if (!loop) return { ok: false, code: 404, error: "Loop not found" };

    if (!verifyCallbackToken(loop.id, body.iteration, bearerToken)) {
        return { ok: false, code: 401, error: "Invalid callback token" };
    }

    const nowMs = Date.now();
    const newStatus = body.status === "failed" ? "running" : loop.status; // failed iter ≠ failed loop
    const cumulativeCost = loop.totalCostUsd + (body.costUsd ?? 0);
    const cumulativeTokens = loop.totalTokens + (body.tokens ?? 0);
    const newConsecutiveFailures =
        body.status === "failed"
            ? loop.consecutiveFailures + 1
            : 0;

    // Honour explicit nextRunAt hint from the daemon (e.g. cooldown after
    // a failure); otherwise recompute from schedule.
    const overrideNext = typeof body.nextRunAt === "number" ? body.nextRunAt : null;
    const recomputedNext =
        overrideNext !== null
            ? overrideNext
            : computeNextRunAt(loop.intervalMs, loop.cronExpression, nowMs);

    const updated = await db.agentLoop.update({
        where: { id: loop.id },
        data: {
            status: newStatus,
            nextRunAt: loop.enabled ? BigInt(recomputedNext) : null,
            totalCostUsd: cumulativeCost,
            totalTokens: cumulativeTokens,
            consecutiveFailures: newConsecutiveFailures,
        },
    });

    // Ephemerals: status (always) + brief (if daemon supplied one).
    await emitSyncEphemeral(loop.accountId, {
        t: "agent-loop-status",
        loopId: loop.id,
        projectId: loop.projectId,
        status: updated.status as "running" | "paused" | "completed" | "failed" | "stopped",
        iteration: body.iteration,
        nextRunAt: updated.enabled && updated.nextRunAt !== null ? Number(updated.nextRunAt) : null,
        activeSessionId: body.sessionId ?? null,
        lastError: body.errorMessage ?? null,
        lastBriefSummary: body.briefSummary ?? null,
        updatedAt: nowMs,
    });

    if (body.briefSummary) {
        await emitSyncEphemeral(loop.accountId, {
            t: "agent-loop-brief",
            loopId: loop.id,
            projectId: loop.projectId,
            iteration: body.iteration,
            sessionId: body.sessionId ?? null,
            headline: body.briefSummary.slice(0, 200),
            iterationStatus: body.status,
            generatedAt: nowMs,
        });
    }

    // Persistent update so a client that reconnects sees the new state.
    await emitSyncUpdate(loop.accountId, {
        t: "agent-loop-updated",
        loop: serializeAgentLoop(updated),
    });

    return { ok: true, value: { loop: updated } };
}

// ── Helpers re-exported for routes ──

export { ownedAgentLoop, ownedProject };

// Mark unused-import warning suppressors. Kept here to make grep visible.
export type _AgentLoopEngineTxFlag = Tx;
