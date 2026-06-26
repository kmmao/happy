/**
 * cronNextRunAt — the single place that turns a cron expression into its next
 * run time, returning null on an unparseable expression.
 *
 * This was duplicated as a private `computeNextRunAt` in both
 * `triggerScheduleRunner.ts` (with an explicit `currentDate`) and
 * `triggerScheduleRoutes.ts` (defaulting to now). Neither copy had a test, so
 * the "invalid cron → null" contract — which decides whether a TriggerSchedule
 * gets a valid `nextRunAt` or is left unscheduled — was unverified in two
 * places. One owner, one test surface.
 *
 * `currentDate` defaults to the parser's "now"; pass it explicitly when
 * scheduling relative to a captured tick.
 */

import { CronExpressionParser } from "cron-parser";

export function cronNextRunAt(cronExpression: string, currentDate?: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(
      cronExpression,
      currentDate ? { currentDate } : undefined,
    );
    return interval.next().toDate();
  } catch {
    return null;
  }
}
