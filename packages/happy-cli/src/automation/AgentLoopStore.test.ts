import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
    });

    const reloaded = new AgentLoopStore(join(dir, "loops.json"));
    await reloaded.load();
    expect(reloaded.get("loop-1")?.name).toBe("CI watcher");
    expect(reloaded.getAll()).toHaveLength(1);
  });
});
