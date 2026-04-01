import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoopCoordinator } from "./AgentLoopCoordinator";
import { AgentLoopStore } from "./AgentLoopStore";
import { AutomationStore } from "./AutomationStore";
import { AutomationScheduler } from "./AutomationScheduler";

let tempDirs: string[] = [];

afterEach(async () => {
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
});
