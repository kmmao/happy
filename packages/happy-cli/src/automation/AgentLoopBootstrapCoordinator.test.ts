import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoopBootstrapStore } from "./AgentLoopBootstrapStore";
import { AgentLoopBootstrapCoordinator } from "./AgentLoopBootstrapCoordinator";
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

describe("AgentLoopBootstrapCoordinator", () => {
  it("materializes missing loop suggestions from a watched root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-bootstrap-coordinator-"));
    tempDirs.push(dir);
    const repo = join(dir, "repo-a");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".github", "workflows"), { recursive: true });
    await writeFile(join(repo, ".github", "workflows", "ci.yml"), "name: ci\n", "utf-8");
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "demo" }), "utf-8");

    const scheduler = createScheduler(dir);
    await scheduler.start();
    const agentLoopCoordinator = new AgentLoopCoordinator({
      store: new AgentLoopStore(join(dir, "loops.json")),
      scheduler,
    });
    await agentLoopCoordinator.start();

    const coordinator = new AgentLoopBootstrapCoordinator({
      store: new AgentLoopBootstrapStore(join(dir, "bootstrap-profiles.json")),
      agentLoopCoordinator,
      pollIntervalMs: 50,
    });
    await coordinator.start();

    const created = await coordinator.createProfile({
      rootDirectory: dir,
      intervalMs: 60_000,
      autoRunCreatedLoops: false,
      runNow: true,
    });

    expect(created.success).toBe(true);
    expect(created.profile?.lastCreatedCount).toBeGreaterThan(0);
    const loops = await agentLoopCoordinator.listLoops();
    expect(loops.some((entry) => entry.directory === repo)).toBe(true);

    await coordinator.stop();
    await agentLoopCoordinator.stop();
    await scheduler.stop();
  });
});
