import { describe, expect, it } from "vitest";
import { AutomationScheduler } from "./AutomationScheduler";
import { AutomationStore } from "./AutomationStore";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveAutomationAuditStats, deriveAutomationGuardianUsage } from "./AutomationAudit";

describe("Automation status snapshot shape", () => {
  it("exposes job snapshots for daemon diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-status-"));
    try {
      const scheduler = new AutomationScheduler({
        store: new AutomationStore(join(dir, "jobs.json")),
        runnerDeps: {
          supervisor: {
            spawnSession: async () => ({ type: "success", sessionId: "sid" }),
            emitSupervisorRunStatus: () => {},
            emitSupervisorFixStatus: () => {},
            serverUrl: "https://example.com",
            authToken: "token",
          },
          webhook: {
            spawnSession: async () => ({ type: "success", sessionId: "sid" }),
            emitWebhookStatus: () => {},
          },
          agentLoop: {
            spawnSession: async () => ({ type: "success", sessionId: "sid" }),
          },
        },
        maxConcurrentDispatches: 0,
        runJob: async () => ({ completion: "immediate" }),
      });

      await scheduler.start();
      await scheduler.enqueueWebhook({
        type: "webhook-trigger",
        webhookEventId: "event-1",
        issueNumber: 1,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/1",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      });

      const jobs = scheduler.getJobsSnapshot();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.kind).toBe("webhook");
      expect(jobs[0]?.status).toBe("queued");

      const guardians = [
        {
          key: "project:project-1",
          projectId: "project-1",
          sessionId: "session-1",
          updatedAt: 50,
        },
      ];
      const recentAuditEvents = [
        {
          id: "audit-1",
          occurredAt: 100,
          kind: "job_enqueued" as const,
          jobId: jobs[0]!.id,
          dedupeKey: jobs[0]!.dedupeKey,
        },
      ];
      const guardianUsage = deriveAutomationGuardianUsage(recentAuditEvents, guardians);
      const auditStats = deriveAutomationAuditStats(recentAuditEvents, guardians);

      expect(guardianUsage[0]?.key).toBe("project:project-1");
      expect(auditStats.totalEvents).toBe(1);
      await scheduler.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
