import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoDreamCoordinator } from "./AutoDreamCoordinator";
import { AutoDreamStore } from "./AutoDreamStore";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AutoDreamCoordinator", () => {
  it("builds and refreshes a dream report from loop memory files", async () => {
    const root = await mkdtemp(join(tmpdir(), "happy-auto-dream-"));
    tempDirs.push(root);
    const repo = join(root, "repo");
    const memoryDir = join(repo, ".happy", "agent-loops", "loop-1");
    await mkdir(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "memory.md");
    const store = new AutoDreamStore(join(root, "auto-dream-profiles.json"));
    const coordinator = new AutoDreamCoordinator({ store, pollIntervalMs: 60_000 });

    await writeFile(memoryFile, [
      "# Happy Agent Loop Memory",
      "",
      "## Goal",
      "Keep CI green.",
      "",
      "## Current Focus",
      "Investigate flaky tests.",
      "",
      "## Working Memory",
      "Main branch has intermittent failures.",
      "",
      "## Reflection Summary",
      "Retry the failing integration suite.",
    ].join("\n"), "utf-8");

    await coordinator.start();
    const created = await coordinator.createProfile({
      name: "repo-dream",
      rootDirectory: root,
      intervalMs: 60_000,
      runNow: true,
    });

    expect(created.success).toBe(true);
    expect(created.profile?.stage).toBe("starting");
    expect(created.profile?.lastMemoryFiles).toBe(1);
    expect(created.profile?.latestDreamFilePath).toBeTruthy();

    const latestPath = created.profile?.latestDreamFilePath!;
    await access(latestPath);
    const report = await readFile(latestPath, "utf-8");
    expect(report).toContain("Happy Auto-Dream");
    expect(report).toContain("Keep CI green.");
    expect(report).toContain("Investigate flaky tests.");

    await writeFile(memoryFile, [
      "# Happy Agent Loop Memory",
      "",
      "## Goal",
      "Keep CI green and deploy safely.",
      "",
      "## Current Focus",
      "Validate release candidate.",
      "",
      "## Working Memory",
      "Release branch is ready for smoke tests.",
      "",
      "## Reflection Summary",
      "Promote once smoke tests stay green.",
    ].join("\n"), "utf-8");

    const rerun = await coordinator.runNow(created.profile!.id);
    expect(rerun.success).toBe(true);
    expect(rerun.profile?.stage).toBe("updating");
    expect(rerun.profile?.lastUpdatedFiles).toBe(1);

    const rerunReport = await readFile(rerun.profile!.latestDreamFilePath!, "utf-8");
    expect(rerunReport).toContain("Keep CI green and deploy safely.");
    expect(rerunReport).toContain("Validate release candidate.");

    await coordinator.stop();
  });
});
