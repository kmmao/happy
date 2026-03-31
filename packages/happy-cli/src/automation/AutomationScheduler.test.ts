import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationStore } from "./AutomationStore";
import { AutomationScheduler } from "./AutomationScheduler";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

function createScheduler(
  dir: string,
  options?: {
    maxConcurrentDispatches?: number;
    runJob?: any;
  },
) {
  const store = new AutomationStore(join(dir, "jobs.json"));
  return new AutomationScheduler({
    store,
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
    },
    pollIntervalMs: 50,
    maxConcurrentDispatches: options?.maxConcurrentDispatches ?? 1,
    runJob: options?.runJob ?? (async () => ({ completion: "immediate" as const })),
  });
}

describe("AutomationScheduler", () => {
  it("requeues non-terminal jobs on start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const store = new AutomationStore(join(dir, "jobs.json"));
    await store.load();
    await store.upsert({
      id: "job-1",
      kind: "webhook",
      status: "running",
      priority: "background",
      dedupeKey: "webhook:event-1",
      attempt: 1,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
      sessionId: "sid-1",
      completionMode: "session",
      payload: {
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
      },
    });

    const scheduler = createScheduler(dir, { maxConcurrentDispatches: 0 });

    try {
      const recovery = await scheduler.start();
      expect(recovery.requeued).toBe(1);
      expect(scheduler.getJobsSnapshot()[0]?.status).toBe("queued");
      expect(scheduler.getJobsSnapshot()[0]?.sessionId).toBeUndefined();
    } finally {
      await scheduler.stop();
    }
  });

  it("dedupes supervisor jobs by run id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);

    try {
      await scheduler.start();
      const payload = {
        type: "supervisor-trigger" as const,
        projectId: "proj",
        runId: "run-1",
        trigger: "analysis",
        machineId: "machine",
        repoPath: "/tmp/repo",
      };
      const first = await scheduler.enqueueSupervisor(payload);
      const second = await scheduler.enqueueSupervisor(payload);
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.job.id).toBe(first.job.id);
    } finally {
      await scheduler.stop();
    }
  });


  it("annotates supervisor jobs with project and loop metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir, { maxConcurrentDispatches: 0 });

    try {
      await scheduler.start();
      const { job } = await scheduler.enqueueSupervisor({
        type: "supervisor-trigger",
        projectId: "proj-1",
        runId: "run-42",
        trigger: "fix",
        machineId: "machine",
        repoPath: "/tmp/repo",
        loopId: "loop-7",
        loopIteration: 3,
        fixAction: {
          title: "Patch flaky test",
          description: "Fix it",
          suggestedFix: null,
          category: "tests",
          severity: "high",
        },
      });

      expect(job.projectId).toBe("proj-1");
      expect(job.runId).toBe("run-42");
      expect(job.loopId).toBe("loop-7");
      expect(job.loopIteration).toBe(3);
      expect(job.label).toBe("Supervisor fix: Patch flaky test");
    } finally {
      await scheduler.stop();
    }
  });

  it("marks session-backed jobs as running and terminal on exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir, {
      runJob: async () => ({ completion: "session", sessionId: "sid-2" }),
    });

    try {
      await scheduler.start();
      await scheduler.enqueueWebhook({
        type: "webhook-trigger",
        webhookEventId: "event-2",
        issueNumber: 2,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/2",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const running = scheduler.getJobsSnapshot()[0];
      expect(running?.status).toBe("running");
      expect(running?.sessionId).toBe("sid-2");

      const completed = await scheduler.markJobTerminalBySession("sid-2", "completed");
      expect(completed?.status).toBe("completed");
    } finally {
      await scheduler.stop();
    }
  });

  it("cancels queued jobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir, { maxConcurrentDispatches: 0 });

    try {
      await scheduler.start();
      const { job } = await scheduler.enqueueWebhook({
        type: "webhook-trigger",
        webhookEventId: "event-3",
        issueNumber: 3,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/3",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      });
      const result = await scheduler.cancelJob(job.id);
      expect(result.success).toBe(true);
      expect(result.job?.status).toBe("cancelled");
    } finally {
      await scheduler.stop();
    }
  });

  it("retries terminal jobs immediately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir, { maxConcurrentDispatches: 0 });

    try {
      await scheduler.start();
      const { job } = await scheduler.enqueueWebhook({
        type: "webhook-trigger",
        webhookEventId: "event-4",
        issueNumber: 4,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/4",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      });
      await scheduler.cancelJob(job.id);
      const retried = await scheduler.retryJob(job.id);
      expect(retried.success).toBe(true);
      expect(retried.job?.status).toBe("queued");
      expect(retried.job?.attempt).toBe(0);
    } finally {
      await scheduler.stop();
    }
  });

  it("clears terminal jobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-scheduler-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir, { maxConcurrentDispatches: 0 });

    try {
      await scheduler.start();
      const { job } = await scheduler.enqueueWebhook({
        type: "webhook-trigger",
        webhookEventId: "event-5",
        issueNumber: 5,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/5",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      });
      await scheduler.cancelJob(job.id);
      const cleared = await scheduler.clearTerminalJobs();
      expect(cleared.success).toBe(true);
      expect(scheduler.getJobsSnapshot()).toHaveLength(0);
    } finally {
      await scheduler.stop();
    }
  });
});
