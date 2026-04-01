import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoopStore } from "./AgentLoopStore";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AgentLoopStore", () => {
  it("persists and reloads loops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-store-"));
    tempDirs.push(dir);
    const store = new AgentLoopStore(join(dir, "loops.json"));
    await store.load();
    await store.upsert({
      id: "loop-1",
      name: "CI watcher",
      prompt: "check CI",
      directory: "/tmp/repo",
      intervalMs: 600000,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      nextRunAt: 2,
      iteration: 0,
      continuityKey: "agent-loop:loop-1",
      agent: "claude",
      runtimeState: "idle",
      phase: "sleeping",
      phaseUpdatedAt: 1,
      lastTriggerSource: "schedule",
      lastTriggerAt: 1,
    });

    const reloaded = new AgentLoopStore(join(dir, "loops.json"));
    await reloaded.load();
    expect(reloaded.get("loop-1")?.name).toBe("CI watcher");
    expect(reloaded.get("loop-1")?.runtimeState).toBe("idle");
    expect(reloaded.get("loop-1")?.phase).toBe("sleeping");
    expect(reloaded.getAll()).toHaveLength(1);
  });

  it("hydrates legacy loops with runtime defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-store-legacy-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "loops.json"), JSON.stringify({
      version: 1,
      loops: [{
        id: "legacy-loop",
        prompt: "check CI",
        directory: "/tmp/repo",
        intervalMs: 600000,
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
        nextRunAt: 3,
        iteration: 0,
        continuityKey: "agent-loop:legacy-loop",
        agent: "claude"
      }]
    }, null, 2));

    const store = new AgentLoopStore(join(dir, "loops.json"));
    await store.load();
    const loop = store.get("legacy-loop");
    expect(loop?.runtimeState).toBe("idle");
    expect(loop?.phase).toBe("sleeping");
    expect(loop?.phaseUpdatedAt).toBe(2);
  });

});
