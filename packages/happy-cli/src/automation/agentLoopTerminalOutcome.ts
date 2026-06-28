/**
 * AgentLoop terminal outcome — the pure decision an iteration's end produces:
 * how to classify the failure, whether to block, how long to back off, and
 * whether to self-heal the guardian Session binding.
 *
 * Extracted from `AgentLoopCoordinator.onJobTerminal`, where this computation
 * was interleaved with its effects (forget guardian, build/persist the updated
 * loop, notify) and so could only be exercised by driving a full loop to a
 * terminal state. The rules here are the bug-prone ones:
 *   - transient vs permanent failure classification (transient faults must NOT
 *     burn the consecutive-failure budget),
 *   - the failure backoff floor and the rate-limit deferral (never schedule
 *     earlier than `now + retryBackoffMs`; defer past a reported reset window),
 *   - the guardian zero-cost self-heal threshold,
 *   - the stop-reason precedence (block > stop-on-success > max-iterations >
 *     daily-budget).
 *
 * The runner (`onJobTerminal`) applies the returned outcome as effects. No
 * behavior change: logic moved verbatim.
 */

import type { AgentLoopDefinition } from "./AgentLoopStore";
import { normalizeDailyCostCounter } from "./agentLoopAutoRunPolicy";

/**
 * Minimum wait between a failed loop iteration and the next attempt. Acts as
 * a floor over `retryBackoffMs ?? intervalMs` so an aggressive interval can't
 * hammer Anthropic during a rate-limit window. Aligned with Anthropic's typical
 * 5-minute short-window.
 */
const FAILURE_BACKOFF_FLOOR_MS = 5 * 60_000;

/**
 * Transient upstream conditions that clear on their own once the rate-limit /
 * overload window resets. These do NOT burn the loop's `consecutiveFailures`
 * budget; anything not in the set counts as a real failure (the safe default).
 */
export const TRANSIENT_ERROR_TYPES = new Set<string>([
  "rate_limit", // Anthropic 429
  "overloaded", // Anthropic 529
  "server_error", // upstream 5xx that isn't an explicit overload
]);

/**
 * Number of back-to-back zero-cost iterations that triggers the self-heal path:
 * forget the guardian Session binding so the next iteration spawns fresh.
 */
const GUARDIAN_FORGET_THRESHOLD = 3;

export interface AgentLoopTerminalParams {
  status: "completed" | "failed" | "cancelled";
  errorType?: string;
  errorMessage?: string;
  sessionCostUsd?: number;
  rateLimitResetsAt?: number;
}

export interface AgentLoopTerminalOutcome {
  failed: boolean;
  isTransient: boolean;
  nextConsecutiveFailures: number;
  shouldBlock: boolean;
  blockedReason?: string;
  reachedMaxIterations: boolean;
  shouldStopOnSuccess: boolean;
  runCost: number;
  newTodayCostUsd: number;
  todayCostWindowStartedAt: number;
  newTotalCostUsd: number;
  dailyBudgetExceeded: boolean;
  stopReason?: string;
  effectiveBackoffMs: number;
  nextConsecutiveZeroCost: number;
  shouldForgetGuardian: boolean;
}

export function computeAgentLoopTerminalOutcome(
  existing: AgentLoopDefinition,
  params: AgentLoopTerminalParams,
  now: number,
): AgentLoopTerminalOutcome {
  const failed = params.status === "failed";
  const isTransient =
    failed && params.errorType !== undefined && TRANSIENT_ERROR_TYPES.has(params.errorType);
  const nextConsecutiveFailures =
    failed && !isTransient
      ? (existing.consecutiveFailures ?? 0) + 1
      : (existing.consecutiveFailures ?? 0);
  const maxConsecutiveFailures = existing.maxConsecutiveFailures ?? 3;
  const shouldBlock = failed && !isTransient && nextConsecutiveFailures >= maxConsecutiveFailures;
  const blockedReason = shouldBlock ? (params.errorMessage ?? params.status) : undefined;
  const reachedMaxIterations = Boolean(
    existing.maxIterations && existing.iteration >= existing.maxIterations,
  );
  const shouldStopOnSuccess = params.status === "completed" && existing.stopOnSuccess === true;

  const runCost =
    params.sessionCostUsd != null &&
    Number.isFinite(params.sessionCostUsd) &&
    params.sessionCostUsd > 0
      ? params.sessionCostUsd
      : 0;
  const dailyCostCounter = normalizeDailyCostCounter(existing, now);
  const newTodayCostUsd = dailyCostCounter.todayCostUsd + runCost;
  const newTotalCostUsd = (existing.totalCostUsd ?? 0) + runCost;
  const dailyBudgetExceeded = Boolean(existing.maxUsdPerDay && newTodayCostUsd >= existing.maxUsdPerDay);

  const stopReason = shouldBlock
    ? undefined
    : shouldStopOnSuccess
      ? "stop-on-success"
      : reachedMaxIterations
        ? "max-iterations"
        : dailyBudgetExceeded
          ? "budget-daily"
          : undefined;

  const retryBackoffMs = Math.max(
    existing.retryBackoffMs ?? existing.intervalMs,
    FAILURE_BACKOFF_FLOOR_MS,
  );
  const rateLimitDeferralMs =
    params.rateLimitResetsAt !== undefined && params.rateLimitResetsAt > now
      ? params.rateLimitResetsAt - now + 30_000
      : 0;
  const effectiveBackoffMs = Math.max(retryBackoffMs, rateLimitDeferralMs);

  const nextConsecutiveZeroCost =
    runCost > 0 ? 0 : (existing.consecutiveZeroCostIterations ?? 0) + 1;
  const shouldForgetGuardian = nextConsecutiveZeroCost >= GUARDIAN_FORGET_THRESHOLD;

  return {
    failed,
    isTransient,
    nextConsecutiveFailures,
    shouldBlock,
    blockedReason,
    reachedMaxIterations,
    shouldStopOnSuccess,
    runCost,
    newTodayCostUsd,
    todayCostWindowStartedAt: dailyCostCounter.todayCostWindowStartedAt,
    newTotalCostUsd,
    dailyBudgetExceeded,
    stopReason,
    effectiveBackoffMs,
    nextConsecutiveZeroCost,
    shouldForgetGuardian,
  };
}
