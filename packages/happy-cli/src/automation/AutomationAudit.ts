import type {
  AutomationAuditEvent,
  AutomationAuditStats,
  AutomationGuardianUsageSummary,
} from "./types";
import type { GuardianSessionEntry } from "./GuardianSessionRegistry";

export function deriveAutomationGuardianUsage(
  events: AutomationAuditEvent[],
  guardians: GuardianSessionEntry[],
): AutomationGuardianUsageSummary[] {
  const usage = new Map<string, AutomationGuardianUsageSummary>();

  const ensure = (key: string, input?: Partial<AutomationGuardianUsageSummary>) => {
    const current = usage.get(key);
    if (current) {
      if (input?.projectId) current.projectId = input.projectId;
      if (input?.loopId) current.loopId = input.loopId;
      if (input?.currentSessionId) current.currentSessionId = input.currentSessionId;
      if (input?.lastUsedAt != null && input.lastUsedAt > current.lastUsedAt) current.lastUsedAt = input.lastUsedAt;
      return current;
    }
    const created: AutomationGuardianUsageSummary = {
      key,
      projectId: input?.projectId,
      loopId: input?.loopId,
      reuseCount: 0,
      rememberCount: 0,
      resetCount: 0,
      lastUsedAt: input?.lastUsedAt ?? 0,
      currentSessionId: input?.currentSessionId,
    };
    usage.set(key, created);
    return created;
  };

  for (const event of events) {
    if (!event.guardianKey) continue;
    const row = ensure(event.guardianKey, {
      projectId: event.projectId,
      loopId: event.loopId,
      lastUsedAt: event.occurredAt,
      currentSessionId: event.guardianSessionId,
    });
    if (event.kind === "guardian_reused") row.reuseCount += 1;
    if (event.kind === "guardian_remembered") row.rememberCount += 1;
    if (event.kind === "guardian_cleared") row.resetCount += 1;
  }

  for (const guardian of guardians) {
    ensure(guardian.key, {
      projectId: guardian.projectId,
      loopId: guardian.loopId,
      currentSessionId: guardian.sessionId,
      lastUsedAt: guardian.updatedAt,
    });
  }

  return [...usage.values()].sort((a, b) => {
    if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    return a.key.localeCompare(b.key);
  });
}

export function deriveAutomationAuditStats(
  events: AutomationAuditEvent[],
  guardians: GuardianSessionEntry[],
): AutomationAuditStats {
  const stats: AutomationAuditStats = {
    totalEvents: events.length,
    lastEventAt: events[0]?.occurredAt,
    queuedCount: 0,
    sessionStartedCount: 0,
    terminalCompletedCount: 0,
    terminalFailedCount: 0,
    terminalCancelledCount: 0,
    guardianReuseCount: 0,
    guardianRememberCount: 0,
    guardianResetCount: 0,
    watchdogStopCount: 0,
    stopRequestCount: 0,
    guardianEligibleRunCount: 0,
    guardianReuseRate: 0,
    activeGuardianCount: guardians.length,
  };

  for (const event of events) {
    switch (event.kind) {
      case "job_enqueued":
        stats.queuedCount += 1;
        break;
      case "job_session_started":
        stats.sessionStartedCount += 1;
        if (event.trigger && event.trigger !== "fix") {
          stats.guardianEligibleRunCount += 1;
        }
        break;
      case "job_terminal":
        if (event.status === "completed") stats.terminalCompletedCount += 1;
        if (event.status === "failed") stats.terminalFailedCount += 1;
        if (event.status === "cancelled") stats.terminalCancelledCount += 1;
        break;
      case "guardian_reused":
        stats.guardianReuseCount += 1;
        break;
      case "guardian_remembered":
        stats.guardianRememberCount += 1;
        break;
      case "guardian_cleared":
        stats.guardianResetCount += 1;
        break;
      case "watchdog_stopped":
        stats.watchdogStopCount += 1;
        break;
      case "session_stop_requested":
        stats.stopRequestCount += 1;
        break;
    }
  }

  stats.guardianReuseRate = stats.guardianEligibleRunCount > 0
    ? stats.guardianReuseCount / stats.guardianEligibleRunCount
    : 0;

  return stats;
}
