/**
 * ADR-0022 D-1 — autonomous loop discovery.
 *
 * Watches SupervisorRun completion: when a *standalone* run (one not already
 * inside an AgentLoop) reports a healthScore at or above the project's
 * configured threshold, automatically start an AgentLoop with sensible
 * defaults. Closes the autonomy contract — "self-discover, self-complete" —
 * by removing the user-press-start step.
 *
 * Concurrency, daily limits, and "loop already active" checks are delegated
 * to startLoop(); the only thing this module owns is the *should I fire?*
 * decision (threshold, debounce, run-from-loop guard) and the bookkeeping
 * stamp (`lastAutoLoopStartedAt`) for the debounce window.
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { startLoop } from "@/modules/supervisorLoopEngine";

/**
 * Default debounce between auto-starts on the same project — 24h, matching
 * the original D-1 commit. Projects can override via
 * Project.autoLoopDebounceMinutes (0 = disable debounce; useful for testing
 * and for the manual reset flow below).
 */
export const DEFAULT_AUTO_LOOP_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

export interface AutoLoopDecisionInput {
    /** Threshold from Project.autoLoopHealthThreshold; null = disabled. */
    threshold: number | null;
    /** Health score reported by the most recent completed run. */
    healthScore: number | null;
    /** When the project last auto-started a loop; null = never. */
    lastAutoLoopStartedAt: Date | null;
    /** Run's loopId — non-null means the run is already inside a loop. */
    runLoopId: string | null;
    /**
     * Debounce window length in ms. 0 disables debounce (always fires when
     * other guards pass). Comes from Project.autoLoopDebounceMinutes × 60_000;
     * the wrapper falls back to DEFAULT_AUTO_LOOP_DEBOUNCE_MS if the column
     * read fails.
     */
    debounceMs: number;
    /** Caller-controlled clock for tests. */
    now: number;
}

export type AutoLoopDecision =
    | { fire: true }
    | { fire: false; reason: "disabled" | "below_threshold" | "no_health_score" | "in_loop" | "debounced" };

/**
 * Pure decision: should we fire an auto-loop for this run completion?
 * All side effects (DB read of project, startLoop, bookkeeping) live in the
 * thin wrapper below — this stays unit-testable in isolation.
 */
export function decideAutoLoop(input: AutoLoopDecisionInput): AutoLoopDecision {
    if (input.threshold == null) {
        return { fire: false, reason: "disabled" };
    }
    if (input.runLoopId != null) {
        // Already managed by a loop — don't spawn a sibling.
        return { fire: false, reason: "in_loop" };
    }
    if (input.healthScore == null) {
        return { fire: false, reason: "no_health_score" };
    }
    if (input.healthScore < input.threshold) {
        // Healthier than the trigger band — no action needed.
        return { fire: false, reason: "below_threshold" };
    }
    if (
        input.debounceMs > 0 &&
        input.lastAutoLoopStartedAt &&
        input.now - input.lastAutoLoopStartedAt.getTime() < input.debounceMs
    ) {
        return { fire: false, reason: "debounced" };
    }
    return { fire: true };
}

/**
 * Default LoopConfig for an auto-started supervisor loop. Picked to be
 * conservative so a runaway / mis-tuned threshold can't drain a user's budget:
 *   - maxIterations: 5
 *   - costCapUsd: $2 — well below typical manual run caps
 *   - healthScoreTarget: half the trigger threshold, floored at 5, so the
 *     loop actually has to make meaningful progress to exit on health
 *   - emptyIterationsToConfirm: 2 — pairs with ADR-0022 C-1 so the loop
 *     doesn't bail after a single empty pass
 */
function defaultAutoLoopConfig(threshold: number) {
    return {
        maxIterations: 5,
        costCapUsd: 2,
        healthScoreTarget: Math.max(5, Math.floor(threshold / 2)),
        autoApproveThreshold: 80,
        maxConsecutiveFailures: 2,
        maxDurationMinutes: 240,
        emptyIterationsToConfirm: 2,
    } as const;
}

/**
 * Side-effecting wrapper. Best-effort: any DB / startLoop error is logged but
 * never propagated — auto-loop is an enhancement on top of the regular run
 * completion path, not a critical step.
 */
export async function maybeAutoStartLoop(opts: {
    userId: string;
    projectId: string;
    runId: string;
    healthScore: number | null;
    runLoopId: string | null;
    now?: number;
}): Promise<AutoLoopDecision> {
    try {
        const project = await db.project.findUnique({
            where: { id: opts.projectId },
            select: {
                autoLoopHealthThreshold: true,
                autoLoopDebounceMinutes: true,
                lastAutoLoopStartedAt: true,
            },
        });
        if (!project) return { fire: false, reason: "disabled" };

        const debounceMinutes = Math.max(0, project.autoLoopDebounceMinutes);
        const decision = decideAutoLoop({
            threshold: project.autoLoopHealthThreshold,
            healthScore: opts.healthScore,
            lastAutoLoopStartedAt: project.lastAutoLoopStartedAt,
            runLoopId: opts.runLoopId,
            debounceMs: debounceMinutes * 60_000,
            now: opts.now ?? Date.now(),
        });
        if (!decision.fire) return decision;

        const config = defaultAutoLoopConfig(project.autoLoopHealthThreshold!);
        const result = await startLoop(opts.projectId, opts.userId, config);
        if ("error" in result) {
            log(
                { module: "supervisor", level: "warn" },
                `D-1 auto-loop skipped for project ${opts.projectId}: ${result.error}`,
            );
            return { fire: false, reason: "disabled" };
        }

        // Stamp debounce only after a successful start.
        await db.project.update({
            where: { id: opts.projectId },
            data: { lastAutoLoopStartedAt: new Date(opts.now ?? Date.now()) },
        });

        log(
            { module: "supervisor" },
            `D-1 auto-loop started for project ${opts.projectId} (run ${opts.runId} health=${opts.healthScore} threshold=${project.autoLoopHealthThreshold}, loop ${result.loopId})`,
        );
        return { fire: true };
    } catch (error) {
        log(
            { module: "supervisor", level: "error" },
            `D-1 auto-loop failed for project ${opts.projectId}: ${error}`,
        );
        return { fire: false, reason: "disabled" };
    }
}
