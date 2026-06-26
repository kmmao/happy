/**
 * AgentLoop auto-run gating — decides whether an AgentLoop may auto-run right
 * now, and owns the day-boundary counter resets that gating depends on.
 *
 * Extracted from `AgentLoopCoordinator.ts` (~1272 lines), where these pure
 * functions were private and reachable only by driving the whole coordinator
 * (emitEvent / tick with a mocked clock). The rules are bug-prone exactly where
 * they are hardest to reach that way:
 *   - quiet hours that wrap past midnight (23:00–06:00),
 *   - cooldown elapsed-time math,
 *   - per-day auto-run quota and USD budget that reset on the LOCAL day
 *     boundary (DST / clock-rewind sensitive),
 *   - the iteration cap.
 *
 * As its own module the gate is a deep seam — `evaluateAutoRunPolicy(loop, now)`
 * returns `{ allowed, reason }` — and every edge case is directly testable.
 * No behavior change: bodies moved verbatim.
 */

import type { AgentLoopDefinition } from "./AgentLoopStore";

/** Local-timezone midnight (00:00:00.000) for the day containing `now`. */
export function localDayStartAt(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Resolve the auto-run counter for `now`'s day: keep the stored count if the
 * window already started today, otherwise reset to 0 for the new day.
 */
export function normalizeAutoRunCounter(
  loop: Pick<AgentLoopDefinition, "autoRunsToday" | "autoRunWindowStartedAt">,
  now: number,
): { autoRunsToday: number; autoRunWindowStartedAt: number } {
  const dayStart = localDayStartAt(now);
  if (loop.autoRunWindowStartedAt === dayStart) {
    return { autoRunsToday: loop.autoRunsToday ?? 0, autoRunWindowStartedAt: dayStart };
  }
  return { autoRunsToday: 0, autoRunWindowStartedAt: dayStart };
}

/** Same day-boundary reset as {@link normalizeAutoRunCounter}, for USD budget. */
export function normalizeDailyCostCounter(
  loop: Pick<AgentLoopDefinition, "todayCostUsd" | "todayCostWindowStartedAt">,
  now: number,
): { todayCostUsd: number; todayCostWindowStartedAt: number } {
  const dayStart = localDayStartAt(now);
  if (loop.todayCostWindowStartedAt === dayStart) {
    return { todayCostUsd: loop.todayCostUsd ?? 0, todayCostWindowStartedAt: dayStart };
  }
  return { todayCostUsd: 0, todayCostWindowStartedAt: dayStart };
}

/**
 * True when `now` falls inside the [start, end) quiet window. Handles windows
 * that wrap past midnight (start > end). Empty/equal bounds = no quiet hours.
 * `start`/`end` are "HH:MM" in local time.
 */
export function isWithinQuietHours(
  now: number,
  start: string | undefined,
  end: string | undefined,
): boolean {
  if (!start || !end || start === end) {
    return false;
  }
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const current = new Date(now);
  const currentMinutes = current.getHours() * 60 + current.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * The auto-run gate. Returns the first failing reason (max-iterations →
 * quiet-hours → cooldown → max-auto-runs → budget-daily) or `{ allowed: true }`.
 */
export function evaluateAutoRunPolicy(
  loop: AgentLoopDefinition,
  now: number,
): { allowed: boolean; reason?: string } {
  if (loop.maxIterations && loop.iteration >= loop.maxIterations) {
    return { allowed: false, reason: "max-iterations" };
  }
  if (isWithinQuietHours(now, loop.quietHoursStart, loop.quietHoursEnd)) {
    return { allowed: false, reason: "quiet-hours" };
  }
  if (loop.cooldownMs && loop.lastCompletedAt && now < loop.lastCompletedAt + loop.cooldownMs) {
    return { allowed: false, reason: "cooldown" };
  }
  if (loop.maxAutoRunsPerDay) {
    const counter = normalizeAutoRunCounter(loop, now);
    if (counter.autoRunsToday >= loop.maxAutoRunsPerDay) {
      return { allowed: false, reason: "max-auto-runs" };
    }
  }
  if (loop.maxUsdPerDay) {
    const costCounter = normalizeDailyCostCounter(loop, now);
    if (costCounter.todayCostUsd >= loop.maxUsdPerDay) {
      return { allowed: false, reason: "budget-daily" };
    }
  }
  return { allowed: true };
}

export function canAutoRun(loop: AgentLoopDefinition, now: number): boolean {
  return evaluateAutoRunPolicy(loop, now).allowed;
}
