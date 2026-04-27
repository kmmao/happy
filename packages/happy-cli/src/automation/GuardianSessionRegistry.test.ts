import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuardianSessionRegistry } from "./GuardianSessionRegistry";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("GuardianSessionRegistry", () => {
  it("resolves loop guardian before project guardian", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-guardian-"));
    tempDirs.push(dir);

    const registry = new GuardianSessionRegistry(join(dir, "guardians.json"));
    await registry.load();
    await registry.rememberForSupervisor({
      type: "supervisor-trigger",
      projectId: "proj-1",
      runId: "run-1",
      trigger: "analysis",
      machineId: "machine",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
      loopIteration: 1,
    }, "session-1");

    const resolved = registry.resolveForSupervisor({
      type: "supervisor-trigger",
      projectId: "proj-1",
      runId: "run-2",
      trigger: "analysis",
      machineId: "machine",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
      loopIteration: 2,
    });

    expect(resolved).toBe("session-1");
  });

  it("forgets a specific guardian key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-guardian-"));
    tempDirs.push(dir);

    const registry = new GuardianSessionRegistry(join(dir, "guardians.json"));
    await registry.load();
    await registry.rememberForSupervisor({
      type: "supervisor-trigger",
      projectId: "proj-1",
      runId: "run-1",
      trigger: "analysis",
      machineId: "machine",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
    }, "session-1");

    await registry.forgetKey("loop:loop-1");
    expect(registry.getSnapshot().map((entry) => entry.key)).toEqual(["project:proj-1:analysis"]);
  });

  it("clears all guardians", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-guardian-"));
    tempDirs.push(dir);

    const registry = new GuardianSessionRegistry(join(dir, "guardians.json"));
    await registry.load();
    await registry.rememberForSupervisor({
      type: "supervisor-trigger",
      projectId: "proj-1",
      runId: "run-1",
      trigger: "analysis",
      machineId: "machine",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
    }, "session-1");

    await registry.clear();
    expect(registry.getSnapshot()).toHaveLength(0);
  });

  it("forgets sessions across all keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-guardian-"));
    tempDirs.push(dir);

    const registry = new GuardianSessionRegistry(join(dir, "guardians.json"));
    await registry.load();
    await registry.rememberForSupervisor({
      type: "supervisor-trigger",
      projectId: "proj-1",
      runId: "run-1",
      trigger: "analysis",
      machineId: "machine",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
    }, "session-1");

    await registry.forgetSession("session-1");
    expect(registry.getSnapshot()).toHaveLength(0);
  });
});
