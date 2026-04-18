import { describe, expect, it } from "vitest";
import { DaemonStateSchema } from "./machineTypes";

describe("DaemonStateSchema", () => {
  it("accepts automation summaries", () => {
    const parsed = DaemonStateSchema.parse({
      status: "running",
      pid: 123,
      httpPort: 4567,
      startedAt: Date.now(),
      startedWithCliVersion: "1.2.3",
      cliInstall: {
        source: "npm-global",
        canSelfUpgrade: true,
      },
      automation: {
        updatedAt: Date.now(),
        counts: {
          queued: 1,
          dispatching: 2,
          running: 3,
          completed: 4,
          failed: 5,
          cancelled: 6,
        },
        recentJobs: [
          {
            id: "job-1",
            kind: "webhook",
            status: "failed",
            priority: "background",
            dedupeKey: "webhook:event-1",
            attempt: 3,
            maxAttempts: 3,
            createdAt: 1,
            updatedAt: 2,
            sessionId: "session-1",
            label: "Issue #1: crash on launch",
            projectId: "project-1",
            loopId: "loop-1",
            loopIteration: 2,
            continuityKey: "loop:loop-1",
            errorMessage: "boom",
          },
        ],
        guardians: [
          {
            key: "loop:loop-1",
            projectId: "project-1",
            loopId: "loop-1",
            sessionId: "session-1",
            updatedAt: Date.now(),
            lastRunId: "run-1",
            attached: true,
          },
        ],
        guardianUsage: [
          {
            key: "loop:loop-1",
            projectId: "project-1",
            loopId: "loop-1",
            reuseCount: 3,
            rememberCount: 2,
            resetCount: 1,
            lastUsedAt: Date.now(),
            currentSessionId: "session-1",
          },
        ],
        auditStats: {
          totalEvents: 10,
          lastEventAt: Date.now(),
          queuedCount: 2,
          sessionStartedCount: 2,
          terminalCompletedCount: 1,
          terminalFailedCount: 1,
          terminalCancelledCount: 0,
          guardianReuseCount: 1,
          guardianRememberCount: 2,
          guardianResetCount: 1,
          sessionReattachedCount: 1,
          watchdogStopCount: 1,
          stopRequestCount: 1,
          guardianEligibleRunCount: 2,
          guardianReuseRate: 0.5,
          activeGuardianCount: 1,
        },
        recentAuditEvents: [
          {
            id: "audit-1",
            occurredAt: Date.now(),
            kind: "guardian_reused",
            sessionId: "session-1",
            projectId: "project-1",
            loopId: "loop-1",
            guardianKey: "loop:loop-1",
            guardianSessionId: "session-1",
            message: "Reused guardian session session-1",
          },
        ],
      },
    });

    expect(parsed.automation?.counts.running).toBe(3);
    expect(parsed.automation?.recentJobs[0]?.id).toBe("job-1");
    expect(parsed.automation?.auditStats?.guardianReuseCount).toBe(1);
    expect(parsed.cliInstall?.source).toBe("npm-global");
  });
});
