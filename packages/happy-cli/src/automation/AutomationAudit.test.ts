import { describe, expect, it } from "vitest";
import { deriveAutomationAuditStats, deriveAutomationGuardianUsage } from "./AutomationAudit";
import type { AutomationAuditEvent } from "./types";
import type { GuardianSessionEntry } from "./GuardianSessionRegistry";

describe("AutomationAudit", () => {
  it("derives guardian usage and audit stats from a production-like event stream", () => {
    const events: AutomationAuditEvent[] = [
      {
        id: "1",
        occurredAt: 100,
        kind: "job_enqueued",
        jobId: "job-1",
        projectId: "project-1",
        loopId: "loop-1",
        trigger: "analysis",
      },
      {
        id: "2",
        occurredAt: 200,
        kind: "guardian_remembered",
        projectId: "project-1",
        loopId: "loop-1",
        guardianKey: "loop:loop-1",
        guardianSessionId: "session-1",
      },
      {
        id: "3",
        occurredAt: 300,
        kind: "job_session_started",
        sessionId: "session-1",
        projectId: "project-1",
        loopId: "loop-1",
        trigger: "analysis",
        status: "running",
      },
      {
        id: "4",
        occurredAt: 400,
        kind: "guardian_reused",
        projectId: "project-1",
        loopId: "loop-1",
        guardianKey: "loop:loop-1",
        guardianSessionId: "session-1",
      },
      {
        id: "5",
        occurredAt: 500,
        kind: "watchdog_stopped",
        sessionId: "session-1",
        message: "watchdog:stalled",
      },
      {
        id: "6",
        occurredAt: 600,
        kind: "session_stop_requested",
        sessionId: "session-1",
      },
      {
        id: "7",
        occurredAt: 700,
        kind: "job_terminal",
        sessionId: "session-1",
        status: "failed",
      },
      {
        id: "8",
        occurredAt: 800,
        kind: "guardian_cleared",
        guardianKey: "loop:loop-1",
      },
      {
        id: "9",
        occurredAt: 850,
        kind: "loop_policy_gated",
        loopId: "loop-1",
        status: "quiet-hours",
      },
      {
        id: "10",
        occurredAt: 875,
        kind: "loop_downstream_emitted",
        loopId: "loop-2",
        status: "completed",
      },
    ];
    const guardians: GuardianSessionEntry[] = [
      {
        key: "project:project-1",
        projectId: "project-1",
        sessionId: "session-2",
        updatedAt: 900,
        lastRunId: "run-2",
      },
    ];

    const usage = deriveAutomationGuardianUsage(events, guardians);
    const stats = deriveAutomationAuditStats(events, guardians);

    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      key: "project:project-1",
      currentSessionId: "session-2",
    });
    expect(usage.find((entry) => entry.key === "loop:loop-1")).toMatchObject({
      reuseCount: 1,
      rememberCount: 1,
      resetCount: 1,
      currentSessionId: "session-1",
    });

    expect(stats).toMatchObject({
      totalEvents: 10,
      queuedCount: 1,
      sessionStartedCount: 1,
      terminalFailedCount: 1,
      guardianReuseCount: 1,
      guardianRememberCount: 1,
      guardianResetCount: 1,
      watchdogStopCount: 1,
      stopRequestCount: 1,
      policyGatedCount: 1,
      downstreamEmitCount: 1,
      guardianEligibleRunCount: 1,
      activeGuardianCount: 1,
    });
    expect(stats.guardianReuseRate).toBe(1);
    expect(stats.lastEventAt).toBe(100);
  });
});
