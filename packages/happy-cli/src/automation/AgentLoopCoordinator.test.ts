import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoopCoordinator } from "./AgentLoopCoordinator";
import { AgentLoopStore } from "./AgentLoopStore";
import { AutomationStore } from "./AutomationStore";
import { AutomationScheduler } from "./AutomationScheduler";
import { persistAgentLoopMemorySnapshot } from "./AgentLoopMemory";
import { readAgentLoopBrief } from "./AgentLoopBrief";

let tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function createScheduler(dir: string) {
  const store = new AutomationStore(join(dir, "jobs.json"));
  return new AutomationScheduler({
    store,
    runnerDeps: {
      supervisor: {
        spawnSession: async () => ({ type: "success", sessionId: "sid" }),
        emitSupervisorRunStatus: () => {},
        emitSupervisorFixStatus: () => {},
        serverUrl: "https://example.com",
      },
      webhook: {
        spawnSession: async () => ({ type: "success", sessionId: "sid" }),
        emitWebhookStatus: () => {},
      },
      agentLoop: {
        spawnSession: async () => ({ type: "success", sessionId: "sid" }),
      },
      task: {
        spawnSession: async () => ({ type: "success", sessionId: "sid" }),
        onTaskStatusChange: () => {},
      },
    },
    pollIntervalMs: 50,
    maxConcurrentDispatches: 0,
    runJob: async () => ({ completion: "immediate" as const }),
  });
}

describe("AgentLoopCoordinator", () => {
  it("creates loops and enqueues immediate run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const result = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: "/tmp/repo",
      intervalMs: 600000,
      runNow: true,
    });

    expect(result.success).toBe(true);
    expect(result.loop?.iteration).toBe(1);
    expect(scheduler.getJobsSnapshot()).toHaveLength(1);
    expect(scheduler.getJobsSnapshot()[0]?.kind).toBe("agent_loop");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("updates loop configuration without resetting runtime history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-update-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: "/tmp/repo",
      intervalMs: 600000,
      runNow: false,
    });

    const result = await coordinator.updateLoop(created.loop!.id, {
      name: "Release watcher",
      prompt: "check deploy status",
      intervalMs: 300000,
      projectId: "project-123",
      environmentVariables: { FOO: "bar" },
    });

    expect(result.success).toBe(true);
    expect(result.loop?.name).toBe("Release watcher");
    expect(result.loop?.prompt).toBe("check deploy status");
    expect(result.loop?.intervalMs).toBe(300000);
    expect(result.loop?.projectId).toBe("project-123");
    expect(result.loop?.environmentVariables).toEqual({ FOO: "bar" });
    expect(result.loop?.iteration).toBe(0);

    await coordinator.stop();
    await scheduler.stop();
  });
  it("transitions loop runtime into blocked when a run fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-blocked-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: "/tmp/repo",
      intervalMs: 600000,
      runNow: false,
    });

    const queued = await coordinator.runNow(created.loop!.id);
    expect(queued.loop?.runtimeState).toBe("active");
    expect(queued.loop?.phase).toBe("planning");

    await coordinator.onJobSessionStarted(created.loop!.id, "sid-live");
    const started = await coordinator.getLoop(created.loop!.id);
    expect(started?.phase).toBe("acting");
    expect(started?.activeSessionId).toBe("sid-live");

    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "failed",
      sessionId: "sid-live",
      errorMessage: "budget exceeded",
    });

    const blocked = await coordinator.getLoop(created.loop!.id);
    expect(blocked?.enabled).toBe(false);
    expect(blocked?.runtimeState).toBe("blocked");
    expect(blocked?.phase).toBe("blocked");
    expect(blocked?.blockedReason).toBe("budget exceeded");
    expect(blocked?.lastReflectionAt).toBeTypeOf("number");

    await coordinator.stop();
    await scheduler.stop();
  });


  it("pauses loop after a successful run when stop-on-success is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-stop-success-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Release finisher",
      prompt: "finish release checklist",
      directory: "/tmp/repo",
      intervalMs: 600000,
      stopOnSuccess: true,
      runNow: false,
    });

    await coordinator.runNow(created.loop!.id);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-live",
    });

    const stopped = await coordinator.getLoop(created.loop!.id);
    expect(stopped?.enabled).toBe(false);
    expect(stopped?.runtimeState).toBe("paused");
    expect(stopped?.phase).toBe("paused");
    expect(stopped?.stopReason).toBe("stop-on-success");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("pauses loop after reaching max iterations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-max-iterations-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Finite investigator",
      prompt: "investigate one bounded issue",
      directory: "/tmp/repo",
      intervalMs: 600000,
      maxIterations: 1,
      runNow: false,
    });

    await coordinator.runNow(created.loop!.id);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-live",
    });

    const stopped = await coordinator.getLoop(created.loop!.id);
    expect(stopped?.enabled).toBe(false);
    expect(stopped?.runtimeState).toBe("paused");
    expect(stopped?.phase).toBe("paused");
    expect(stopped?.stopReason).toBe("max-iterations");
    expect(stopped?.lastPolicyGateReason).toBe("max-iterations");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("accepts loop events and dispatches them immediately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-event-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: "/tmp/repo",
      intervalMs: 600000,
      runNow: false,
    });

    const result = await coordinator.emitEvent(created.loop!.id, {
      source: "github",
      title: "CI failed on main",
      details: "workflow=test",
      autoRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.loop?.runtimeState).toBe("active");
    expect(result.loop?.lastTriggerSource).toBe("event");
    expect(result.loop?.recentEvents?.[0]?.status).toBe("dispatched");
    expect(result.loop?.recentEvents?.[0]?.source).toBe("github");
    expect(scheduler.getJobsSnapshot()).toHaveLength(1);
    const payload = scheduler.getJobsSnapshot()[0]?.payload as any;
    expect(payload?.trigger).toBe("event");
    expect(payload?.eventTitle).toBe("CI failed on main");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("syncs loop memory from disk after a run finishes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-memory-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: dir,
      intervalMs: 600000,
      goal: "Keep the repo green",
      runNow: false,
    });

    await coordinator.runNow(created.loop!.id);
    await persistAgentLoopMemorySnapshot(dir, created.loop!.id, {
      goal: "Keep the repo green",
      currentFocus: "Investigate flaky test failures",
      workingMemory: "Test suite became unstable after dependency bump",
      lastReflectionSummary: "Need to isolate flaky cases before changing CI policy",
      memoryUpdatedAt: Date.now(),
    });

    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-live",
    });

    const synced = await coordinator.getLoop(created.loop!.id);
    expect(synced?.goal).toBe("Keep the repo green");
    expect(synced?.currentFocus).toBe("Investigate flaky test failures");
    expect(synced?.workingMemory).toContain("dependency bump");
    expect(synced?.lastReflectionSummary).toContain("flaky cases");
    expect(synced?.memoryUpdatedAt).toBeTypeOf("number");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("ignores events whose source is not allowed by loop filters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-filter-source-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "CI watcher",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      eventSourceAllowlist: ["github-webhook"],
      runNow: false,
    });

    const result = await coordinator.emitEvent(created.loop!.id, {
      source: "file-watch",
      title: "Repository files changed",
      autoRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.loop?.recentEvents?.[0]?.status).toBe("ignored");
    expect(result.loop?.recentEvents?.[0]?.errorMessage).toContain("not allowed");
    expect(scheduler.getJobsSnapshot()).toHaveLength(0);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("accepts events that match keyword filters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-filter-keywords-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "CI watcher",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      eventKeywordFilters: ["workflow", "ci"],
      runNow: false,
    });

    const result = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "Workflow failed on main",
      details: "ci pipeline red",
      autoRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.loop?.recentEvents?.[0]?.status).toBe("dispatched");
    expect(scheduler.getJobsSnapshot()).toHaveLength(1);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("retries failed loops until the configured failure budget is exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-retry-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "CI Watchdog",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      maxConsecutiveFailures: 3,
      retryBackoffMs: 120000,
      runNow: false,
    });

    const firstQueued = await coordinator.runNow(created.loop!.id);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "failed",
      sessionId: "sid-1",
      errorMessage: "temporary network issue",
    });

    const firstFailure = await coordinator.getLoop(created.loop!.id);
    expect(firstQueued.success).toBe(true);
    expect(firstFailure?.enabled).toBe(true);
    expect(firstFailure?.runtimeState).toBe("idle");
    expect(firstFailure?.consecutiveFailures).toBe(1);
    expect(firstFailure?.blockedReason).toBeUndefined();
    expect((firstFailure?.nextRunAt ?? 0) - (firstFailure?.lastCompletedAt ?? 0)).toBe(120000);

    await coordinator.runNow(created.loop!.id);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "failed",
      sessionId: "sid-2",
      errorMessage: "temporary network issue",
    });
    const secondFailure = await coordinator.getLoop(created.loop!.id);
    expect(secondFailure?.consecutiveFailures).toBe(2);
    expect(secondFailure?.runtimeState).toBe("idle");

    await coordinator.runNow(created.loop!.id);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "failed",
      sessionId: "sid-3",
      errorMessage: "persistent failure",
    });
    const blocked = await coordinator.getLoop(created.loop!.id);
    expect(blocked?.enabled).toBe(false);
    expect(blocked?.runtimeState).toBe("blocked");
    expect(blocked?.consecutiveFailures).toBe(3);
    expect(blocked?.blockedReason).toBe("persistent failure");

    await coordinator.stop();
    await scheduler.stop();
  });

  it("keeps auto-run events pending during quiet hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T23:30:00"));
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-quiet-hours-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Quiet loop",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      runNow: false,
    });

    const result = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "CI failed",
      autoRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.loop?.recentEvents?.[0]?.status).toBe("pending");
    expect(result.loop?.iteration).toBe(0);
    expect(result.loop?.lastPolicyGateReason).toBe("quiet-hours");
    expect(result.loop?.lastPolicyGateAt).toBeTypeOf("number");
    expect(scheduler.getJobsSnapshot()).toHaveLength(0);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("gates repeated auto-runs after hitting the daily cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T10:00:00"));
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-daily-cap-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Daily cap loop",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      maxAutoRunsPerDay: 1,
      runNow: false,
    });

    const first = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "First CI failure",
      autoRun: true,
    });
    expect(first.loop?.recentEvents?.[0]?.status).toBe("dispatched");
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-cap-1",
    });

    const second = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "Second CI failure",
      autoRun: true,
    });
    expect(second.loop?.recentEvents?.[0]?.status).toBe("pending");
    expect(second.loop?.iteration).toBe(1);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("respects cooldown for auto-runs but not manual runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T10:00:00"));
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-cooldown-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Cooldown loop",
      prompt: "watch ci",
      directory: "/tmp/repo",
      intervalMs: 600000,
      cooldownMs: 3600000,
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      maxAutoRunsPerDay: 1,
      runNow: false,
    });

    const first = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "Initial event",
      autoRun: true,
    });
    expect(first.loop?.iteration).toBe(1);
    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-cooldown-1",
    });

    vi.setSystemTime(new Date("2025-01-01T10:05:00"));
    const gated = await coordinator.emitEvent(created.loop!.id, {
      source: "github-webhook",
      title: "Too soon",
      autoRun: true,
    });
    expect(gated.loop?.recentEvents?.[0]?.status).toBe("pending");
    expect(gated.loop?.iteration).toBe(1);

    vi.setSystemTime(new Date("2025-01-01T23:30:00"));
    (scheduler as any).getActiveJobByLoopId = () => undefined;
    const manual = await coordinator.runNow(created.loop!.id);
    expect(manual.success).toBe(true);
    expect(manual.loop?.iteration).toBe(2);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("emits downstream loop events after successful upstream completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-downstream-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await coordinator.start();

    const downstream = await coordinator.createLoop({
      name: "Downstream",
      prompt: "respond to upstream",
      directory: "/tmp/downstream",
      intervalMs: 600000,
      runNow: false,
    });
    const upstream = await coordinator.createLoop({
      name: "Upstream",
      prompt: "produce signal",
      directory: "/tmp/upstream",
      intervalMs: 600000,
      downstreamLoopIds: [downstream.loop!.id],
      downstreamTriggerOn: ["completed"],
      runNow: false,
    });

    await coordinator.runNow(upstream.loop!.id);
    await coordinator.onJobTerminal({
      loopId: upstream.loop!.id,
      status: "completed",
      sessionId: "sid-upstream-1",
    });

    const downstreamLoop = await coordinator.getLoop(downstream.loop!.id);
    expect(downstreamLoop?.recentEvents?.[0]?.source).toBe("loop-completed");
    expect(downstreamLoop?.recentEvents?.[0]?.status).toBe("dispatched");
    expect(downstreamLoop?.iteration).toBe(1);

    await coordinator.stop();
    await scheduler.stop();
  });

  it("generates a brief and sends push notifications on terminal completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-coordinator-brief-"));
    tempDirs.push(dir);
    const scheduler = createScheduler(dir);
    await scheduler.start();
    const sendPushNotification = vi.fn();
    const coordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
      sendPushNotification,
    });
    await coordinator.start();

    const created = await coordinator.createLoop({
      name: "Repo watcher",
      prompt: "check tests",
      directory: dir,
      intervalMs: 600000,
      goal: "Keep the repo green",
      currentFocus: "Investigate flaky tests",
      notifyEvents: ["completed", "brief"],
      notificationChannels: ["push"],
      runNow: false,
    });

    await coordinator.runNow(created.loop!.id);
    await persistAgentLoopMemorySnapshot(dir, created.loop!.id, {
      goal: "Keep the repo green",
      currentFocus: "Investigate flaky tests",
      workingMemory: "Release train is blocked by flaky integration coverage.",
      lastReflectionSummary: "Stabilize tests before cutting the release branch.",
      memoryUpdatedAt: Date.now(),
    });

    await coordinator.onJobTerminal({
      loopId: created.loop!.id,
      status: "completed",
      sessionId: "sid-brief-1",
    });

    const updated = await coordinator.getLoop(created.loop!.id);
    const brief = await readAgentLoopBrief(dir, created.loop!.id);
    expect(updated?.lastBriefAt).toBeTypeOf("number");
    expect(updated?.lastBriefSummary).toContain("Investigate flaky tests");
    expect(brief).toContain("Happy Loop Brief");
    expect(brief).toContain("Keep the repo green");
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification.mock.calls[0]?.[0]?.title).toContain("Repo watcher");

    await coordinator.stop();
    await scheduler.stop();
  });

});
